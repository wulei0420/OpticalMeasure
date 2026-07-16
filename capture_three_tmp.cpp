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
    while (pEnum->Next(1, &pPin, NULL) == S_OK) {
        PIN_DIRECTION dir;
        pPin->QueryDirection(&dir);
        if (dir == PINDIR_OUTPUT) {
            IAMStreamConfig* pCfg = nullptr;
            hr = pPin->QueryInterface(IID_IAMStreamConfig, (void**)&pCfg);
            if (SUCCEEDED(hr)) {
                int cnt = 0, sz = 0;
                pCfg->GetNumberOfCapabilities(&cnt, &sz);
                for (int i = 0; i < cnt; i++) {
                    AM_MEDIA_TYPE* pmt = nullptr;
                    VIDEO_STREAM_CONFIG_CAPS caps;
                    hr = pCfg->GetStreamCaps(i, &pmt, (BYTE*)&caps);
                    if (SUCCEEDED(hr) && pmt && pmt->formattype == FORMAT_VideoInfo) {
                        VIDEOINFOHEADER* vih = (VIDEOINFOHEADER*)pmt->pbFormat;
                        if (vih->bmiHeader.biWidth == (LONG)w &&
                            vih->bmiHeader.biHeight == (LONG)h) {
                            hr = pCfg->SetFormat(pmt);
                            pCfg->Release();
                            pPin->Release();
                            pEnum->Release();
                            if (pmt) { if (pmt->cbFormat) CoTaskMemFree(pmt->pbFormat); CoTaskMemFree(pmt); }
                            return hr;
                        }
                    }
                    if (pmt) { if (pmt->cbFormat) CoTaskMemFree(pmt->pbFormat); CoTaskMemFree(pmt); }
                }
                // Exact match not found: use first format and hope for the best
                AM_MEDIA_TYPE* pmt2 = nullptr;
                VIDEO_STREAM_CONFIG_CAPS caps2;
                if (SUCCEEDED(pCfg->GetStreamCaps(0, &pmt2, (BYTE*)&caps2))) {
                    VIDEOINFOHEADER* vih2 = (VIDEOINFOHEADER*)pmt2->pbFormat;
                    vih2->bmiHeader.biWidth = w;
                    vih2->bmiHeader.biHeight = h;
                    vih2->bmiHeader.biSizeImage = w * h * 3;
                    hr = pCfg->SetFormat(pmt2);
                    if (pmt2) { if (pmt2->cbFormat) CoTaskMemFree(pmt2->pbFormat); CoTaskMemFree(pmt2); }
                    pCfg->Release();
                    pPin->Release();
                    pEnum->Release();
                    return hr;
                }
                pCfg->Release();
            }
        }
        pPin->Release();
    }
    pEnum->Release();
    return E_FAIL;
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
    set_capture_format(pSrc, w, h);

    // Create sample grabber
    ISampleGrabber* pGrab = nullptr;
    hr = CoCreateInstance(CLSID_SampleGrabber, NULL, CLSCTX_INPROC_SERVER,
                          IID_ISampleGrabber, (void**)&pGrab);
    if (FAILED(hr)) { pSrc->Release(); pBuilder->Release(); pGraph->Release(); if (com_init) CoUninitialize(); return false; }

    IBaseFilter* pGrabF = nullptr;
    pGrab->QueryInterface(IID_IBaseFilter, (void**)&pGrabF);
    hr = pGraph->AddFilter(pGrabF, L"Grabber");

    // Set sample grabber to RGB24
    AM_MEDIA_TYPE mt;
    ZeroMemory(&mt, sizeof(mt));
    mt.majortype = MEDIATYPE_Video;
    mt.subtype = MEDIASUBTYPE_RGB24;
    pGrab->SetMediaType(&mt);

    // Set buffer mode
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
            // Wait up to 3 seconds for sample
            for (int wc = 0; wc < 30; wc++) {
                long cb = 0;
                pGrab->GetCurrentBuffer(&cb, NULL);
                if (cb > 0) break;
                Sleep(100);
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
                    if (connMt.formattype == FORMAT_VideoInfo) {
                        VIDEOINFOHEADER* vih = (VIDEOINFOHEADER*)connMt.pbFormat;
                        actualW = vih->bmiHeader.biWidth;
                        actualH = abs(vih->bmiHeader.biHeight);
                    }
                    if (connMt.cbFormat) CoTaskMemFree(connMt.pbFormat);

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

// ===== Main =====
int main(int argc, char* argv[]) {
    std::string mode = "1080p", out_dir = ".", cfg_path, sides_str;
    std::string serials[3];
    bool scan = false;
    const char* labels[] = {"left", "center", "right"};
    bool capture[3] = {true, true, true}; // by default all 3

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

    if (serials[0].empty() && capture[0]) {
        fprintf(stderr, "ERROR: need camera serials (--left/--center/--right or --cfg)\n");
        MFShutdown(); CoUninitialize(); return 1;
    }

    // Match serials to DSHOW indices
    int indices[3] = {-1, -1, -1};
    for (int pi = 0; pi < 3; pi++) {
        if (!capture[pi]) continue;
        for (auto& c : cams) {
            if (c.serial == serials[pi]) {
                indices[pi] = c.dshow_idx;
                break;
            }
        }
        if (indices[pi] < 0) {
            for (auto& c : cams) {
                if (c.serial.find(serials[pi]) != std::string::npos ||
                    serials[pi].find(c.serial) != std::string::npos) {
                    indices[pi] = c.dshow_idx;
                    break;
                }
            }
        }
        if (indices[pi] < 0) {
            fprintf(stderr, "ERROR: '%s' (serial=%s) not found\n",
                    labels[pi], serials[pi].c_str());
            MFShutdown(); CoUninitialize(); return 1;
        }
    }

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
