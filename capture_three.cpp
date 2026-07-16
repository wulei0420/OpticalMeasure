/*
 * capture_three.exe v2 — Native DirectShow parallel capture
 * Compile: build.bat
 * Usage:
 *   capture_three.exe --scan
 *   capture_three.exe --cfg camera_serials.json --sides left,right --out C:\tmp --mode 1080p
 */

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <dshow.h>
#include <mfapi.h>
#include <mfidl.h>
#include <shlwapi.h>
#include <wincodec.h>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <string>
#include <vector>
#include <thread>
#include <fstream>
#include <mutex>

// Sample Grabber interface (removed from modern Windows SDK)
struct ISampleGrabberCB : public IUnknown {
    virtual HRESULT STDMETHODCALLTYPE SampleCB(double, IMediaSample*) = 0;
    virtual HRESULT STDMETHODCALLTYPE BufferCB(double, BYTE*, long) = 0;
};
struct ISampleGrabber : public IUnknown {
    virtual HRESULT STDMETHODCALLTYPE SetOneShot(BOOL) = 0;
    virtual HRESULT STDMETHODCALLTYPE SetMediaType(const AM_MEDIA_TYPE*) = 0;
    virtual HRESULT STDMETHODCALLTYPE GetConnectedMediaType(AM_MEDIA_TYPE*) = 0;
    virtual HRESULT STDMETHODCALLTYPE SetBufferSamples(BOOL) = 0;
    virtual HRESULT STDMETHODCALLTYPE GetCurrentBuffer(long*, long*) = 0;
    virtual HRESULT STDMETHODCALLTYPE GetCurrentSample(IMediaSample**) = 0;
    virtual HRESULT STDMETHODCALLTYPE SetCallback(ISampleGrabberCB*, long) = 0;
};
static const GUID CLSID_SampleGrabber = {0xC1F400A0,0x3F08,0x11D3,{0x9F,0x0B,0x00,0x60,0x08,0x03,0x9E,0x37}};
static const GUID IID_ISampleGrabber  = {0x6B652FFF,0x11FE,0x4FCE,{0x92,0xAD,0x02,0x66,0xB5,0xD7,0xC7,0x8F}};

#pragma comment(lib, "strmiids.lib")
#pragma comment(lib, "mf.lib")
#pragma comment(lib, "mfplat.lib")
#pragma comment(lib, "mfuuid.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "oleaut32.lib")
#pragma comment(lib, "shlwapi.lib")
#pragma comment(lib, "windowscodecs.lib")

// ===== JSON helper =====
static std::string json_val(const std::string& key, const std::string& path) {
    std::ifstream f(path);
    if (!f) return "";
    std::string s((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
    auto p = s.find("\"" + key + "\"");
    if (p == std::string::npos) return "";
    p = s.find(':', p);
    if (p == std::string::npos) return "";
    p = s.find('"', p);
    if (p == std::string::npos) return "";
    auto e = s.find('"', p + 1);
    if (e == std::string::npos) return "";
    return s.substr(p + 1, e - p - 1);
}

struct CamEntry {
    std::wstring name, symlink;
    std::string serial;
    int dshow_idx = -1;
};

struct CaptureJob {
    int target_w, target_h;
    std::string out_path, label;
    bool ok = false;
    std::string err;
    double elapsed = 0;
};

// ===== Serial extraction =====
static std::string extract_serial(const std::wstring& symlink) {
    char buf[512];
    WideCharToMultiByte(CP_ACP, 0, symlink.c_str(), -1, buf, sizeof(buf), NULL, NULL);
    std::string s(buf);
    auto pos = s.find("vid_");
    if (pos != std::string::npos) {
        auto h1 = s.find('#', pos);
        if (h1 != std::string::npos) {
            auto h2 = s.find('#', h1 + 1);
            if (h2 != std::string::npos)
                return s.substr(h1 + 1, h2 - h1 - 1);
        }
    }
    return s.substr(0, std::min<size_t>(s.size(), 64));
}

// ===== MF enumeration (for --scan and DSHOW index map) =====
static std::vector<CamEntry> enumerate_mf() {
    std::vector<CamEntry> result;
    IMFAttributes* pAttr = nullptr;
    MFCreateAttributes(&pAttr, 1);
    pAttr->SetGUID(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE,
                   MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID);
    IMFActivate** ppDev = nullptr;
    UINT32 count = 0;
    if (SUCCEEDED(MFEnumDeviceSources(pAttr, &ppDev, &count))) {
        for (UINT32 i = 0; i < count; i++) {
            CamEntry ce;
            ce.dshow_idx = (int)i;
            WCHAR* sl = nullptr; UINT32 slen = 0;
            ppDev[i]->GetAllocatedString(
                MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK, &sl, &slen);
            if (sl) { ce.symlink = sl; ce.serial = extract_serial(sl); CoTaskMemFree(sl); }
            WCHAR* fn = nullptr; UINT32 flen = 0;
            ppDev[i]->GetAllocatedString(MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME, &fn, &flen);
            if (fn) { ce.name = fn; CoTaskMemFree(fn); }
            ppDev[i]->Release();
            result.push_back(ce);
        }
        CoTaskMemFree(ppDev);
    }
    pAttr->Release();
    return result;
}

// ===== Find DShow index by camera serial (MF enumeration) =====
static int find_idx_by_serial(const std::string& serial) {
    auto cams = enumerate_mf();
    for (auto& c : cams) {
        if (c.serial == serial || serial.find(c.serial) != std::string::npos || c.serial.find(serial) != std::string::npos)
            return c.dshow_idx;
    }
    return -1;
}

// ===== Find DShow index by serial via DShow enumeration (matches get_moniker_by_index) =====
static int find_dshow_idx_by_serial(const std::string& serial) {
    ICreateDevEnum* pDevEnum = nullptr;
    CoInitializeEx(NULL, COINIT_MULTITHREADED);
    CoCreateInstance(CLSID_SystemDeviceEnum, NULL, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&pDevEnum));
    if (!pDevEnum) { CoUninitialize(); return -1; }
    IEnumMoniker* pEnum = nullptr;
    pDevEnum->CreateClassEnumerator(CLSID_VideoInputDeviceCategory, &pEnum, 0);
    pDevEnum->Release();
    if (!pEnum) { CoUninitialize(); return -1; }
    IMoniker* pMon = nullptr;
    int idx = 0;
    while (pEnum->Next(1, &pMon, NULL) == S_OK) {
        IPropertyBag* pBag = nullptr;
        pMon->BindToStorage(0, 0, IID_IPropertyBag, (void**)&pBag);
        VARIANT var; VariantInit(&var);
        bool found = false;
        if (pBag && SUCCEEDED(pBag->Read(L"DevicePath", &var, 0))) {
            char buf[512];
            WideCharToMultiByte(CP_ACP, 0, var.bstrVal, -1, buf, sizeof(buf), NULL, NULL);
            if (strstr(buf, serial.c_str())) found = true;
            VariantClear(&var);
        }
        if (pBag) pBag->Release();
        if (found) { pEnum->Release(); pMon->Release(); CoUninitialize(); return idx; }
        pMon->Release();
        idx++;
    }
    pEnum->Release(); CoUninitialize();
    return -1;
}

// ===== Get IMoniker for DSHOW camera by index =====
static IMoniker* get_moniker_by_index(int target_idx) {
    ICreateDevEnum* pDevEnum = nullptr;
    CoCreateInstance(CLSID_SystemDeviceEnum, NULL, CLSCTX_INPROC_SERVER,
                     IID_PPV_ARGS(&pDevEnum));
    if (!pDevEnum) return nullptr;

    IEnumMoniker* pEnum = nullptr;
    pDevEnum->CreateClassEnumerator(CLSID_VideoInputDeviceCategory, &pEnum, 0);
    pDevEnum->Release();
    if (!pEnum) return nullptr;

    IMoniker* pMon = nullptr;
    int idx = 0;
    while (pEnum->Next(1, &pMon, NULL) == S_OK) {
        // Get friendly name + device path
        IPropertyBag* pBag = nullptr;
        pMon->BindToStorage(0, 0, IID_IPropertyBag, (void**)&pBag);
        VARIANT var; VariantInit(&var);
        if (pBag && SUCCEEDED(pBag->Read(L"FriendlyName", &var, 0))) {
            fprintf(stderr, "[DShow enum] idx=%d name=%S\n", idx, var.bstrVal);
            VariantClear(&var);
        }
        // Print device path which contains VID/PID
        if (pBag && SUCCEEDED(pBag->Read(L"DevicePath", &var, 0))) {
            fprintf(stderr, "[DShow enum] idx=%d path=%S\n", idx, var.bstrVal);
            VariantClear(&var);
        }
        if (pBag) pBag->Release();

        if (idx == target_idx) {
            pEnum->Release();
            return pMon;
        }
        pMon->Release();
        idx++;
    }
    pEnum->Release();
    return nullptr;
}

// ===== Set capture resolution via IAMStreamConfig =====
static HRESULT set_capture_format(IBaseFilter* pSrc, int w, int h) {
    IEnumPins* pEnum = nullptr;
    HRESULT hr = pSrc->EnumPins(&pEnum);
    if (FAILED(hr)) return hr;

    IPin* pPin = nullptr;
    HRESULT bestHr = E_FAIL;
    while (pEnum->Next(1, &pPin, NULL) == S_OK) {
        PIN_DIRECTION dir;
        pPin->QueryDirection(&dir);
        if (dir == PINDIR_OUTPUT) {
            IAMStreamConfig* pCfg = nullptr;
            hr = pPin->QueryInterface(IID_IAMStreamConfig, (void**)&pCfg);
            if (SUCCEEDED(hr)) {
                int cnt = 0, sz = 0;
                pCfg->GetNumberOfCapabilities(&cnt, &sz);
                // Try exact match first
                for (int i = 0; i < cnt; i++) {
                    AM_MEDIA_TYPE* pmt = nullptr;
                    VIDEO_STREAM_CONFIG_CAPS caps;
                    if (SUCCEEDED(pCfg->GetStreamCaps(i, &pmt, (BYTE*)&caps)) &&
                        pmt && pmt->formattype == FORMAT_VideoInfo) {
                        VIDEOINFOHEADER* vih = (VIDEOINFOHEADER*)pmt->pbFormat;
                        if (vih->bmiHeader.biWidth == (LONG)w &&
                            vih->bmiHeader.biHeight == (LONG)h) {
                            bestHr = pCfg->SetFormat(pmt);
                            if (pmt->cbFormat) CoTaskMemFree(pmt->pbFormat);
                            CoTaskMemFree(pmt);
                            pCfg->Release(); pPin->Release(); pEnum->Release();
                            return bestHr;
                        }
                        if (pmt->cbFormat) CoTaskMemFree(pmt->pbFormat);
                        CoTaskMemFree(pmt);
                    }
                }
                // No exact match: try first format with forced resolution
                AM_MEDIA_TYPE* pmt2 = nullptr;
                VIDEO_STREAM_CONFIG_CAPS caps2;
                if (SUCCEEDED(pCfg->GetStreamCaps(0, &pmt2, (BYTE*)&caps2))) {
                    VIDEOINFOHEADER* vih2 = (VIDEOINFOHEADER*)pmt2->pbFormat;
                    vih2->bmiHeader.biWidth = w;
                    vih2->bmiHeader.biHeight = h;
                    vih2->bmiHeader.biSizeImage = w * h * 3;
                    bestHr = pCfg->SetFormat(pmt2);
                    if (pmt2->cbFormat) CoTaskMemFree(pmt2->pbFormat);
                    CoTaskMemFree(pmt2);
                }
                pCfg->Release();
            }
        }
        pPin->Release();
        if (SUCCEEDED(bestHr)) break;
    }
    pEnum->Release();
    return bestHr;
}

// ===== Save RGB24 buffer as JPEG via WIC =====
static bool save_jpeg(const BYTE* rgb, int w, int h, int stride,
                      const std::wstring& wpath) {
    IWICImagingFactory* pFactory = nullptr;
    CoCreateInstance(CLSID_WICImagingFactory, NULL, CLSCTX_INPROC_SERVER,
                     IID_PPV_ARGS(&pFactory));
    if (!pFactory) return false;

    IWICBitmap* pBitmap = nullptr;
    HRESULT hr = pFactory->CreateBitmapFromMemory(
        w, h, GUID_WICPixelFormat24bppRGB, stride,
        (UINT)(stride * h), (BYTE*)rgb, &pBitmap);
    if (FAILED(hr)) { pFactory->Release(); return false; }

    IWICBitmapEncoder* pEncoder = nullptr;
    hr = pFactory->CreateEncoder(GUID_ContainerFormatJpeg, NULL, &pEncoder);
    if (FAILED(hr)) { pBitmap->Release(); pFactory->Release(); return false; }

    IWICStream* pStream = nullptr;
    hr = pFactory->CreateStream(&pStream);
    if (FAILED(hr)) { pEncoder->Release(); pBitmap->Release(); pFactory->Release(); return false; }

    hr = pStream->InitializeFromFilename(wpath.c_str(), GENERIC_WRITE);
    if (FAILED(hr)) { pStream->Release(); pEncoder->Release(); pBitmap->Release(); pFactory->Release(); return false; }

    hr = pEncoder->Initialize(pStream, WICBitmapEncoderNoCache);
    if (FAILED(hr)) { pStream->Release(); pEncoder->Release(); pBitmap->Release(); pFactory->Release(); return false; }

    IWICBitmapFrameEncode* pFrame = nullptr;
    IPropertyBag2* pProps = nullptr;
    hr = pEncoder->CreateNewFrame(&pFrame, &pProps);
    if (SUCCEEDED(hr) && pProps) {
        PROPBAG2 opt = {};
        opt.pstrName = (LPOLESTR)L"ImageQuality";
        VARIANT v; VariantInit(&v);
        V_VT(&v) = VT_R4; V_R4(&v) = 0.9f;
        pProps->Write(1, &opt, &v);
        pProps->Release();
    }
    if (FAILED(hr)) { pStream->Release(); pEncoder->Release(); pBitmap->Release(); pFactory->Release(); return false; }

    hr = pFrame->Initialize(NULL);
    if (FAILED(hr)) { pFrame->Release(); pStream->Release(); pEncoder->Release(); pBitmap->Release(); pFactory->Release(); return false; }

    hr = pFrame->WriteSource(pBitmap, NULL);
    pFrame->Commit();
    pEncoder->Commit();
    pFrame->Release();
    pStream->Release();
    pEncoder->Release();
    pBitmap->Release();
    pFactory->Release();
    return SUCCEEDED(hr);
}

// ===== Native DirectShow capture =====
// ===== Streaming mode: MJPEG output to stdout =====
static int cap_dshow_stream(int idx, int w, int h) {
    HRESULT hr = CoInitializeEx(NULL, COINIT_MULTITHREADED);
    bool com_init = SUCCEEDED(hr);

    IMoniker* pMon = get_moniker_by_index(idx);
    if (!pMon) { if (com_init) CoUninitialize(); return 1; }

    IGraphBuilder* pGraph = nullptr;
    hr = CoCreateInstance(CLSID_FilterGraph, NULL, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&pGraph));
    if (FAILED(hr)) { pMon->Release(); if (com_init) CoUninitialize(); return 1; }

    ICaptureGraphBuilder2* pBuilder = nullptr;
    hr = CoCreateInstance(CLSID_CaptureGraphBuilder2, NULL, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&pBuilder));
    if (FAILED(hr)) { pGraph->Release(); pMon->Release(); if (com_init) CoUninitialize(); return 1; }
    pBuilder->SetFiltergraph(pGraph);

    IBaseFilter* pSrc = nullptr;
    hr = pMon->BindToObject(NULL, NULL, IID_IBaseFilter, (void**)&pSrc);
    pMon->Release();
    if (FAILED(hr)) { pBuilder->Release(); pGraph->Release(); if (com_init) CoUninitialize(); return 1; }

    hr = pGraph->AddFilter(pSrc, L"Source");
    if (FAILED(hr)) { pSrc->Release(); pBuilder->Release(); pGraph->Release(); if (com_init) CoUninitialize(); return 1; }

    HRESULT hrFmt = set_capture_format(pSrc, w, h);
    if (FAILED(hrFmt)) { pSrc->Release(); pBuilder->Release(); pGraph->Release(); if (com_init) CoUninitialize(); return 1; }

    ISampleGrabber* pGrab = nullptr;
    hr = CoCreateInstance(CLSID_SampleGrabber, NULL, CLSCTX_INPROC_SERVER, IID_ISampleGrabber, (void**)&pGrab);
    if (FAILED(hr)) { pSrc->Release(); pBuilder->Release(); pGraph->Release(); if (com_init) CoUninitialize(); return 1; }

    IBaseFilter* pGrabF = nullptr;
    pGrab->QueryInterface(IID_IBaseFilter, (void**)&pGrabF);
    hr = pGraph->AddFilter(pGrabF, L"Grabber");
    pGrab->SetBufferSamples(TRUE);
    pGrab->SetOneShot(FALSE);

    hr = pBuilder->RenderStream(&PIN_CATEGORY_CAPTURE, &MEDIATYPE_Video, pSrc, NULL, pGrabF);
    if (FAILED(hr)) {
        hr = pBuilder->RenderStream(&PIN_CATEGORY_PREVIEW, &MEDIATYPE_Video, pSrc, NULL, pGrabF);
    }

    if (FAILED(hr)) {
        pGrabF->Release(); pGrab->Release(); pSrc->Release();
        pBuilder->Release(); pGraph->Release();
        if (com_init) CoUninitialize();
        return 1;
    }

    IMediaControl* pCtrl = nullptr;
    pGraph->QueryInterface(IID_IMediaControl, (void**)&pCtrl);
    if (!pCtrl) {
        pGrabF->Release(); pGrab->Release(); pSrc->Release();
        pBuilder->Release(); pGraph->Release();
        if (com_init) CoUninitialize();
        return 1;
    }

    pCtrl->Run();
    // Wait for first frame
    for (int wc = 0; wc < 30; wc++) {
        long cb = 0;
        pGrab->GetCurrentBuffer(&cb, NULL);
        if (cb > 0) break;
        Sleep(60);
    }
    // Drop initial frames
    for (int drop = 0; drop < 3; drop++) { Sleep(80); }

    // Stream loop: read frame → write [4-byte LE length][JPEG] to stdout
    while (true) {
        long bufSize = 0;
        hr = pGrab->GetCurrentBuffer(&bufSize, NULL);
        if (FAILED(hr) || bufSize <= 0) { Sleep(40); continue; }

        std::vector<BYTE> buf(bufSize);
        hr = pGrab->GetCurrentBuffer(&bufSize, (long*)buf.data());
        if (FAILED(hr) || bufSize <= 0) { Sleep(40); continue; }

        uint32_t len = (uint32_t)bufSize;
        if (fwrite(&len, 4, 1, stdout) != 1) break;
        if (fwrite(buf.data(), 1, bufSize, stdout) != bufSize) break;
        fflush(stdout);
    }

    pCtrl->Stop(); pCtrl->Release();
    pGrabF->Release(); pGrab->Release();
    pSrc->Release(); pBuilder->Release(); pGraph->Release();
    if (com_init) CoUninitialize();
    return 0;
}

static bool cap_dshow_native(int idx, int w, int h,
                              const std::string& out, double* elapsed) {
    LARGE_INTEGER fq, t0, t1;
    QueryPerformanceFrequency(&fq); QueryPerformanceCounter(&t0);

    HRESULT hr = CoInitializeEx(NULL, COINIT_MULTITHREADED);
    bool com_init = SUCCEEDED(hr);

    // Get moniker
    IMoniker* pMon = get_moniker_by_index(idx);
    if (!pMon) {
        if (com_init) CoUninitialize();
        QueryPerformanceCounter(&t1);
        *elapsed = double(t1.QuadPart - t0.QuadPart) / fq.QuadPart;
        return false;
    }

    // Create filter graph
    IGraphBuilder* pGraph = nullptr;
    hr = CoCreateInstance(CLSID_FilterGraph, NULL, CLSCTX_INPROC_SERVER,
                          IID_PPV_ARGS(&pGraph));
    if (FAILED(hr)) { pMon->Release(); if (com_init) CoUninitialize(); return false; }

    ICaptureGraphBuilder2* pBuilder = nullptr;
    hr = CoCreateInstance(CLSID_CaptureGraphBuilder2, NULL, CLSCTX_INPROC_SERVER,
                          IID_PPV_ARGS(&pBuilder));
    if (FAILED(hr)) { pGraph->Release(); pMon->Release(); if (com_init) CoUninitialize(); return false; }
    pBuilder->SetFiltergraph(pGraph);

    // Create capture filter
    IBaseFilter* pSrc = nullptr;
    hr = pMon->BindToObject(NULL, NULL, IID_IBaseFilter, (void**)&pSrc);
    pMon->Release();
    if (FAILED(hr)) { pBuilder->Release(); pGraph->Release(); if (com_init) CoUninitialize(); return false; }

    hr = pGraph->AddFilter(pSrc, L"Source");
    if (FAILED(hr)) { pSrc->Release(); pBuilder->Release(); pGraph->Release(); if (com_init) CoUninitialize(); return false; }

    // Set resolution
    HRESULT hrFmt = set_capture_format(pSrc, w, h);
    if (FAILED(hrFmt)) {
        pSrc->Release(); pBuilder->Release(); pGraph->Release();
        if (com_init) CoUninitialize();
        return false;
    }

    // Create sample grabber
    ISampleGrabber* pGrab = nullptr;
    hr = CoCreateInstance(CLSID_SampleGrabber, NULL, CLSCTX_INPROC_SERVER,
                          IID_ISampleGrabber, (void**)&pGrab);
    if (FAILED(hr)) { pSrc->Release(); pBuilder->Release(); pGraph->Release(); if (com_init) CoUninitialize(); return false; }

    IBaseFilter* pGrabF = nullptr;
    pGrab->QueryInterface(IID_IBaseFilter, (void**)&pGrabF);
    hr = pGraph->AddFilter(pGrabF, L"Grabber");

    // Let sample grabber accept native format (MJPG preserves camera white balance)
    pGrab->SetBufferSamples(TRUE);
    pGrab->SetOneShot(FALSE);

    // Render stream — connect source output to grabber input directly
    // (avoid RenderStream NULL which creates ActiveMovie Window)
    hr = pBuilder->RenderStream(&PIN_CATEGORY_CAPTURE, &MEDIATYPE_Video,
                                pSrc, NULL, pGrabF);
    if (FAILED(hr)) {
        hr = pBuilder->RenderStream(&PIN_CATEGORY_PREVIEW, &MEDIATYPE_Video,
                                    pSrc, NULL, pGrabF);
    }

    if (SUCCEEDED(hr)) {
        IMediaControl* pCtrl = nullptr;
        pGraph->QueryInterface(IID_IMediaControl, (void**)&pCtrl);
        if (pCtrl) {
            pCtrl->Run();
            // Wait for first frame to arrive
            for (int wc = 0; wc < 30; wc++) {
                long cb = 0;
                pGrab->GetCurrentBuffer(&cb, NULL);
                if (cb > 0) break;
                Sleep(60);
            }
            // Drop initial frames (camera stabilization, avoid interlacing)
            for (int drop = 0; drop < 4; drop++) {
                long cb0 = 0;
                pGrab->GetCurrentBuffer(&cb0, NULL);
                Sleep(80);
            }
            long bufSize = 0;
            hr = pGrab->GetCurrentBuffer(&bufSize, NULL);
            if (SUCCEEDED(hr) && bufSize > 0) {
                std::vector<BYTE> buf(bufSize);
                hr = pGrab->GetCurrentBuffer(&bufSize, (long*)buf.data());
                if (SUCCEEDED(hr) && bufSize > 0) {
                    // Get actual width/height from sample grabber's connected media type
                    AM_MEDIA_TYPE connMt;
                    ZeroMemory(&connMt, sizeof(connMt));
                    pGrab->GetConnectedMediaType(&connMt);
                    int actualW = w, actualH = h;
                    bool is_mjpg = (connMt.subtype == MEDIASUBTYPE_MJPG);
                    if (connMt.formattype == FORMAT_VideoInfo) {
                        VIDEOINFOHEADER* vih = (VIDEOINFOHEADER*)connMt.pbFormat;
                        actualW = vih->bmiHeader.biWidth;
                        actualH = abs(vih->bmiHeader.biHeight);
                    }
                    if (is_mjpg) actualW = w, actualH = h; // MJPG resolution unreliable from header

                    if (is_mjpg) {
                        // MJPG: buffer is already JPEG from camera hardware → save directly
                        if (connMt.cbFormat) CoTaskMemFree(connMt.pbFormat);
                        int flen = MultiByteToWideChar(CP_UTF8, 0, out.c_str(), -1, NULL, 0);
                        std::vector<WCHAR> fout(flen);
                        MultiByteToWideChar(CP_UTF8, 0, out.c_str(), -1, fout.data(), flen);
                        FILE* fp = nullptr;
                        if (_wfopen_s(&fp, fout.data(), L"wb") == 0 && fp) {
                            fwrite(buf.data(), 1, bufSize, fp);
                            fclose(fp);
                            std::ifstream chk(out, std::ios::binary | std::ios::ate);
                            if (chk.tellg() >= 1024) {
                                QueryPerformanceCounter(&t1);
                                *elapsed = double(t1.QuadPart - t0.QuadPart) / fq.QuadPart;
                                pCtrl->Stop(); pCtrl->Release();
                                pGrabF->Release(); pGrab->Release();
                                pSrc->Release(); pBuilder->Release(); pGraph->Release();
                                if (com_init) CoUninitialize();
                                return true;
                            }
                        }
                    } else {

                    int stride = ((actualW * 24 + 31) / 32) * 4;

                    // Handle top-down vs bottom-up
                    std::vector<BYTE> flipped;
                    const BYTE* src = buf.data();
                    int imgH = actualH;
                    bool bottomUp = true; // most cameras give bottom-up RGB
                    if (bottomUp && imgH > 0) {
                        flipped.resize(stride * imgH);
                        for (int y = 0; y < imgH; y++)
                            memcpy(&flipped[y * stride], &buf[(imgH - 1 - y) * stride], stride);
                        src = flipped.data();
                    }

                    int wlen = (int)out.length() + 1;
                    int wcnt = MultiByteToWideChar(CP_UTF8, 0, out.c_str(), -1, NULL, 0);
                    std::vector<WCHAR> wout(wcnt);
                    MultiByteToWideChar(CP_UTF8, 0, out.c_str(), -1, wout.data(), wcnt);

                    // Save as JPEG
                    if (save_jpeg(src, actualW, actualH, stride, wout.data())) {
                        std::ifstream chk(out, std::ios::binary | std::ios::ate);
                        if (chk.tellg() >= 1024) {
                            QueryPerformanceCounter(&t1);
                            *elapsed = double(t1.QuadPart - t0.QuadPart) / fq.QuadPart;
                            pCtrl->Stop();
                            pCtrl->Release();
                            pGrabF->Release();
                            pGrab->Release();
                            pSrc->Release();
                            pBuilder->Release();
                            pGraph->Release();
                            if (com_init) CoUninitialize();
                            return true;
                        }
                    }
                    } // end else (non-MJPG)
                }
            }
            pCtrl->Stop();
            pCtrl->Release();
        }
    }

    pGrabF->Release();
    pGrab->Release();
    pSrc->Release();
    pBuilder->Release();
    pGraph->Release();
    if (com_init) CoUninitialize();
    QueryPerformanceCounter(&t1);
    *elapsed = double(t1.QuadPart - t0.QuadPart) / fq.QuadPart;
    return false;
}

// ===== Camera property control (for settings panel) =====

static void print_prop(IBaseFilter* pSrc, const char* label, long prop, const char* unit) {
    IAMVideoProcAmp* pAmp = nullptr;
    if (SUCCEEDED(pSrc->QueryInterface(IID_IAMVideoProcAmp, (void**)&pAmp))) {
        long val, flags;
        if (SUCCEEDED(pAmp->Get(prop, &val, &flags))) {
            long minv, maxv, step, def, capf;
            pAmp->GetRange(prop, &minv, &maxv, &step, &def, &capf);
            printf("  %-14s: %ld %s (range %ld-%ld, step %ld, %s)\n",
                   label, val, unit, minv, maxv, step,
                   (flags == VideoProcAmp_Flags_Auto) ? "auto" : "manual");
        }
        pAmp->Release();
    }
}
static void print_cam_ctrl(IBaseFilter* pSrc, const char* label, long prop, const char* unit) {
    IAMCameraControl* pCtrl = nullptr;
    if (SUCCEEDED(pSrc->QueryInterface(IID_IAMCameraControl, (void**)&pCtrl))) {
        long val, flags;
        if (SUCCEEDED(pCtrl->Get(prop, &val, &flags))) {
            long minv, maxv, step, def, capf;
            pCtrl->GetRange(prop, &minv, &maxv, &step, &def, &capf);
            printf("  %-14s: %ld %s (range %ld-%ld, step %ld, %s)\n",
                   label, val, unit, minv, maxv, step,
                   (flags == CameraControl_Flags_Auto) ? "auto" : "manual");
        }
        pCtrl->Release();
    }
}
static bool get_camera_props(int idx) {
    IMoniker* pMon = get_moniker_by_index(idx);
    if (!pMon) { fprintf(stderr, "Camera idx %d not found\n", idx); return false; }
    IBaseFilter* pSrc = nullptr;
    if (FAILED(pMon->BindToObject(NULL, NULL, IID_IBaseFilter, (void**)&pSrc))) {
        pMon->Release(); return false;
    }
    pMon->Release();
    printf("Camera idx %d properties:\n", idx);
    print_prop(pSrc, "Brightness",    VideoProcAmp_Brightness,    "");
    print_prop(pSrc, "Contrast",      VideoProcAmp_Contrast,      "");
    print_prop(pSrc, "Saturation",    VideoProcAmp_Saturation,    "");
    print_prop(pSrc, "Sharpness",     VideoProcAmp_Sharpness,     "");
    print_prop(pSrc, "WhiteBalance",  VideoProcAmp_WhiteBalance,  "K");
    print_prop(pSrc, "BacklightComp", VideoProcAmp_BacklightCompensation, "");
    print_cam_ctrl(pSrc, "Exposure",  CameraControl_Exposure,     "");
    pSrc->Release();
    return true;
}
static bool set_video_proc_amp(int idx, long prop, long value, bool auto_mode) {
    IMoniker* pMon = get_moniker_by_index(idx);
    if (!pMon) return false;
    IBaseFilter* pSrc = nullptr;
    if (FAILED(pMon->BindToObject(NULL, NULL, IID_IBaseFilter, (void**)&pSrc))) {
        pMon->Release(); return false;
    }
    pMon->Release();
    IAMVideoProcAmp* pAmp = nullptr;
    if (FAILED(pSrc->QueryInterface(IID_IAMVideoProcAmp, (void**)&pAmp))) {
        pSrc->Release(); return false;
    }
    long flags = auto_mode ? VideoProcAmp_Flags_Auto : VideoProcAmp_Flags_Manual;
    HRESULT hr = pAmp->Set(prop, value, flags);
    pAmp->Release(); pSrc->Release();
    return SUCCEEDED(hr);
}
static bool set_cam_control(int idx, long prop, long value, bool auto_mode) {
    IMoniker* pMon = get_moniker_by_index(idx);
    if (!pMon) return false;
    IBaseFilter* pSrc = nullptr;
    if (FAILED(pMon->BindToObject(NULL, NULL, IID_IBaseFilter, (void**)&pSrc))) {
        pMon->Release(); return false;
    }
    pMon->Release();
    IAMCameraControl* pCtrl = nullptr;
    if (FAILED(pSrc->QueryInterface(IID_IAMCameraControl, (void**)&pCtrl))) {
        pSrc->Release(); return false;
    }
    long flags = auto_mode ? CameraControl_Flags_Auto : CameraControl_Flags_Manual;
    HRESULT hr = pCtrl->Set(prop, value, flags);
    pCtrl->Release(); pSrc->Release();
    return SUCCEEDED(hr);
}

// ===== Main =====
int main(int argc, char* argv[]) {
    std::string mode = "1080p", out_dir = ".", cfg_path, sides_str;
    std::string serials[3];
    bool scan = false;
    const char* labels[] = {"left", "center", "right"};
    bool capture[3] = {true, true, true};

    // Property args
    std::string prop_serial, set_sn_wb; long set_val_wb = 0;
    std::string set_sn_bright; long set_val_bright = 0;
    std::string set_sn_sat; long set_val_sat = 0;
    std::string set_sn_exp; long set_val_exp = 0;
    bool prop_auto = false;
    int direct_idx[3] = {-1, -1, -1}; // direct index mode (--left-idx etc., bypass serials)
    bool use_direct_idx = false;
    int stream_idx = -1; // --stream <idx>: MJPEG to stdout mode
    int single_idx = -1; // --single <idx>: capture one frame to --out file
    bool stream_mode = false;
    bool single_mode = false;
    std::string cam_serial; // --serial <s>: find camera by serial instead of index

    for (int i = 1; i < argc; i++) {
        std::string a(argv[i]);
        if (a == "--scan") scan = true;
        else if (a == "--mode" && i+1 < argc) mode = argv[++i];
        else if (a == "--out" && i+1 < argc) out_dir = argv[++i];
        else if (a == "--cfg" && i+1 < argc) cfg_path = argv[++i];
        else if (a == "--sides" && i+1 < argc) sides_str = argv[++i];
        else if (a == "--left" && i+1 < argc)  serials[0] = argv[++i];
        else if (a == "--center" && i+1 < argc) serials[1] = argv[++i];
        else if (a == "--right" && i+1 < argc)  serials[2] = argv[++i];
        else if (a == "--left-idx" && i+1 < argc) { direct_idx[0] = atoi(argv[++i]); use_direct_idx = true; }
        else if (a == "--center-idx" && i+1 < argc) { direct_idx[1] = atoi(argv[++i]); use_direct_idx = true; }
        else if (a == "--right-idx" && i+1 < argc) { direct_idx[2] = atoi(argv[++i]); use_direct_idx = true; }
        else if (a == "--get-props" && i+1 < argc) prop_serial = argv[++i];
        else if (a == "--set-wb" && i+2 < argc) {
            set_sn_wb = argv[++i]; set_val_wb = atol(argv[++i]); }
        else if (a == "--set-brightness" && i+2 < argc) {
            set_sn_bright = argv[++i]; set_val_bright = atol(argv[++i]); }
        else if (a == "--set-saturation" && i+2 < argc) {
            set_sn_sat = argv[++i]; set_val_sat = atol(argv[++i]); }
        else if (a == "--set-exposure" && i+2 < argc) {
            set_sn_exp = argv[++i]; set_val_exp = atol(argv[++i]); }
        else if (a == "--auto") prop_auto = true;
        else if (a == "--stream" && i+1 < argc) { std::string v(argv[i+1]); if (v[0] != '-') stream_idx = atoi(argv[++i]); stream_mode = true; }
        else if (a == "--single" && i+1 < argc) { std::string v(argv[i+1]); if (v[0] != '-') single_idx = atoi(argv[++i]); single_mode = true; }
        else if (a == "--serial" && i+1 < argc) cam_serial = argv[++i];
    }

    // Parse --sides (comma-separated: left,right)
    if (!sides_str.empty()) {
        for (int i = 0; i < 3; i++) capture[i] = false;
        size_t pos = 0;
        while (pos < sides_str.size()) {
            auto comma = sides_str.find(',', pos);
            std::string side = sides_str.substr(pos, comma - pos);
            for (int i = 0; i < 3; i++)
                if (side == labels[i]) capture[i] = true;
            if (comma == std::string::npos) break;
            pos = comma + 1;
        }
    }

    if (!cfg_path.empty()) {
        for (int i = 0; i < 3; i++) {
            auto v = json_val(labels[i], cfg_path);
            if (!v.empty()) serials[i] = v;
        }
        auto m = json_val("resolution", cfg_path);
        if (!m.empty()) mode = m;
    }

    int tw = 1920, th = 1080;
    if (mode == "4k" || mode == "4K" || mode == "auto") { tw = 3840; th = 2160; }
    else if (mode == "360p") { tw = 640; th = 360; }

    // --single mode: capture one frame from one camera to file
    if (single_mode) {
        if (!cam_serial.empty()) single_idx = find_idx_by_serial(cam_serial);
        if (single_idx < 0) { fprintf(stderr, "serial not found\n"); return 1; }
        double elapsed = 0;
        bool ok = cap_dshow_native(single_idx, tw, th, out_dir, &elapsed);
        printf("[single %d] %s %.2fs -> %s\n", single_idx, ok ? "OK" : "FAIL", elapsed, out_dir.c_str());
        return ok ? 0 : 1;
    }

    // --stream mode: single-camera MJPEG to stdout
    if (stream_mode) {
        if (!cam_serial.empty()) stream_idx = find_idx_by_serial(cam_serial);
        if (stream_idx < 0) { fprintf(stderr, "serial not found\n"); return 1; }
        return cap_dshow_stream(stream_idx, tw, th);
    }

    CoInitializeEx(NULL, COINIT_MULTITHREADED);
    MFStartup(MF_VERSION);
    auto cams = enumerate_mf();

    if (scan) {
        printf("Found %zu camera(s):\n", cams.size());
        for (size_t i = 0; i < cams.size(); i++) {
            printf("  [%zu] %S\n       serial: %s\n       DSHOW idx: %d\n",
                   i, cams[i].name.c_str(), cams[i].serial.c_str(), cams[i].dshow_idx);
        }
        printf("\nRecommended camera_serials.json:\n");
        printf("  {\"left\":\"%s\",\"center\":\"%s\",\"right\":\"%s\"}\n",
               cams.size()>1?cams[1].serial.c_str():"?",
               cams.size()>0?cams[0].serial.c_str():"?",
               cams.size()>2?cams[2].serial.c_str():"?");
        MFShutdown(); CoUninitialize(); return 0;
    }

    // Property mode: --get-props, --set-wb, etc.
    auto find_idx = [&](const std::string& sn) -> int {
        for (auto& c : cams) {
            if (c.serial == sn || c.serial.find(sn) != std::string::npos ||
                sn.find(c.serial) != std::string::npos)
                return c.dshow_idx;
        }
        return -1;
    };

    if (!prop_serial.empty()) {
        int idx = find_idx(prop_serial);
        if (idx < 0) { fprintf(stderr, "Not found\n"); MFShutdown(); CoUninitialize(); return 1; }
        CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
        get_camera_props(idx);
        CoUninitialize();
        MFShutdown(); CoUninitialize(); return 0;
    }
    if (!set_sn_wb.empty()) {
        int idx = find_idx(set_sn_wb);
        if (idx < 0) { fprintf(stderr, "Not found\n"); MFShutdown(); CoUninitialize(); return 1; }
        CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
        set_video_proc_amp(idx, VideoProcAmp_WhiteBalance, set_val_wb, prop_auto);
        CoUninitialize();
        MFShutdown(); CoUninitialize(); return 0;
    }
    if (!set_sn_bright.empty()) {
        int idx = find_idx(set_sn_bright);
        if (idx < 0) { fprintf(stderr, "Not found\n"); MFShutdown(); CoUninitialize(); return 1; }
        CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
        set_video_proc_amp(idx, VideoProcAmp_Brightness, set_val_bright, prop_auto);
        CoUninitialize();
        MFShutdown(); CoUninitialize(); return 0;
    }
    if (!set_sn_sat.empty()) {
        int idx = find_idx(set_sn_sat);
        if (idx < 0) { fprintf(stderr, "Not found\n"); MFShutdown(); CoUninitialize(); return 1; }
        CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
        set_video_proc_amp(idx, VideoProcAmp_Saturation, set_val_sat, prop_auto);
        CoUninitialize();
        MFShutdown(); CoUninitialize(); return 0;
    }
    if (!set_sn_exp.empty()) {
        int idx = find_idx(set_sn_exp);
        if (idx < 0) { fprintf(stderr, "Not found\n"); MFShutdown(); CoUninitialize(); return 1; }
        CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
        set_cam_control(idx, CameraControl_Exposure, set_val_exp, prop_auto);
        CoUninitialize();
        MFShutdown(); CoUninitialize(); return 0;
    }

    if (serials[0].empty() && capture[0] && !use_direct_idx) {
        fprintf(stderr, "ERROR: need --left --center --right serials or --cfg or --left-idx/--center-idx/--right-idx\n");
        MFShutdown(); CoUninitialize(); return 1;
    }

    int indices[3] = {-1, -1, -1};
    if (use_direct_idx) {
        // Direct index mode: use DShow indices directly (no serial matching)
        for (int i = 0; i < 3; i++) indices[i] = direct_idx[i];
    } else {
        // Match serials via MF enumeration
        for (int pi = 0; pi < 3; pi++) {
            if (!capture[pi]) continue;
            for (auto& c : cams) {
                if (c.serial == serials[pi] || c.serial.find(serials[pi]) != std::string::npos ||
                    serials[pi].find(c.serial) != std::string::npos) {
                    indices[pi] = c.dshow_idx;
                    break;
                }
            }
            if (indices[pi] < 0) {
                fprintf(stderr, "ERROR: '%s' (serial=%s) not found\n",
                        labels[pi], serials[pi].c_str());
                MFShutdown(); CoUninitialize(); return 1;
            }
        }
    } // end serial matching

    // Capture in parallel
    CaptureJob jobs[3];
    std::thread threads[3];
    int ncap = 0;
    for (int i = 0; i < 3; i++) {
        if (!capture[i]) continue;
        jobs[i].target_w = tw; jobs[i].target_h = th;
        jobs[i].label = labels[i];
        jobs[i].out_path = out_dir + "\\" + labels[i] + ".jpg";
        threads[ncap++] = std::thread([i, &jobs, &indices]() {
            auto& j = jobs[i];
            j.ok = cap_dshow_native(indices[i], j.target_w, j.target_h,
                                     j.out_path, &j.elapsed);
            if (!j.ok) j.err = "native DSHOW failed";
        });
    }
    for (int t = 0; t < ncap; t++) threads[t].join();

    bool all_ok = true;
    for (int i = 0; i < 3; i++) {
        if (!capture[i]) continue;
        if (jobs[i].ok)
            printf("[%s] OK %.2fs -> %s\n",
                   jobs[i].label.c_str(), jobs[i].elapsed, jobs[i].out_path.c_str());
        else {
            fprintf(stderr, "[%s] FAIL: %s\n", jobs[i].label.c_str(), jobs[i].err.c_str());
            all_ok = false;
        }
    }

    MFShutdown(); CoUninitialize();
    return all_ok ? 0 : 1;
}
