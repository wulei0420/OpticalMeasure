/*
 * stereo_calibrate.exe — Standard stereo calibration via cv::stereoCalibrate
 * Takes calibration frame directory, outputs R/T to JSON.
 * Compile: see build.bat
 * Usage:
 *   stereo_calibrate.exe --frames calib_frames --pattern 17x17 --square 10 --image-size 3840x2160
 */

#include <opencv2/opencv.hpp>
#include <opencv2/calib3d.hpp>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include <map>
#include <algorithm>
#include <cmath>
#include <fstream>
#include <sstream>

using namespace cv;
using namespace std;

// ===== Helpers =====
static vector<String> list_pngs(const string& dir) {
    vector<String> files;
    glob(dir + "/*.png", files, false);
    sort(files.begin(), files.end());
    return files;
}

static string base_name(const string& path) {
    auto pos = path.find_last_of("/\\");
    return pos == string::npos ? path : path.substr(pos + 1);
}

// ===== Main =====
int main(int argc, char* argv[]) {
    string frames_dir = "calib_frames";
    int pattern_w = 17, pattern_h = 17;
    float square_mm = 10.0f;
    int img_w = 3840, img_h = 2160;

    for (int i = 1; i < argc; i++) {
        string a(argv[i]);
        if (a == "--frames" && i + 1 < argc) frames_dir = argv[++i];
        else if (a == "--pattern" && i + 1 < argc) {
            string p = argv[++i];
            auto x = p.find('x');
            if (x != string::npos) {
                pattern_w = stoi(p.substr(0, x));
                pattern_h = stoi(p.substr(x + 1));
            }
        }
        else if (a == "--square" && i + 1 < argc) square_mm = stof(argv[++i]);
        else if (a == "--image-size" && i + 1 < argc) {
            string s = argv[++i];
            auto x = s.find('x');
            if (x != string::npos) {
                img_w = stoi(s.substr(0, x));
                img_h = stoi(s.substr(x + 1));
            }
        }
    }

    Size pattern(pattern_w, pattern_h);
    Size img_size(img_w, img_h);

    // Collect frames
    auto files = list_pngs(frames_dir);
    if (files.empty()) {
        fprintf(stderr, "No PNG files in %s\n", frames_dir.c_str());
        return 1;
    }

    // Group by timestamp
    map<string, map<string, string>> groups; // ts -> {left/center/right -> path}
    for (const auto& f : files) {
        string bn = base_name(f);
        auto us1 = bn.find('_');
        if (us1 == string::npos) continue;
        string pos = bn.substr(0, us1);
        string ts = bn.substr(us1 + 1);
        if (pos == "left" || pos == "center" || pos == "right")
            groups[ts][pos] = f;
    }

    // Prepare object points
    vector<Point3f> obj_corners;
    for (int y = 0; y < pattern_h; y++)
        for (int x = 0; x < pattern_w; x++)
            obj_corners.push_back(Point3f(x * square_mm, y * square_mm, 0));

    vector<vector<Point3f>> objpts[3];    // per camera: list of [289x3]
    vector<vector<Point2f>> imgpts[3];    // per camera: list of [289x2]

    int n_groups = 0;
    for (const auto& kv : groups) {
        const auto& g = kv.second;
        if (g.size() < 3) continue;

        vector<vector<Point2f>> corners;
        bool ok = true;
        for (const string& pos : {"left", "center", "right"}) {
            auto it = g.find(pos);
            if (it == g.end()) { ok = false; break; }

            Mat img = imread(it->second, IMREAD_GRAYSCALE);
            if (img.empty()) { ok = false; break; }

            // Downscale for speed if large
            Mat small = img;
            double scale = 1.0;
            if (max(img.cols, img.rows) > 2000) {
                scale = 1920.0 / max(img.cols, img.rows);
                resize(img, small, Size(), scale, scale, INTER_AREA);
            }

            vector<Point2f> c;
            bool found = findChessboardCorners(small, pattern, c,
                CALIB_CB_ADAPTIVE_THRESH + CALIB_CB_NORMALIZE_IMAGE);
            if (!found) { ok = false; break; }

            cornerSubPix(small, c, Size(11, 11), Size(-1, -1),
                TermCriteria(TermCriteria::EPS + TermCriteria::MAX_ITER, 30, 0.001));

            if (scale != 1.0) {
                for (auto& pt : c) pt *= (1.0 / scale);
            }
            corners.push_back(c);
        }
        if (!ok) continue;

        n_groups++;
        for (int i = 0; i < 3; i++) {
            objpts[i].push_back(obj_corners);
            imgpts[i].push_back(corners[i]);
        }
    }

    fprintf(stderr, "Valid frame groups: %d (all used)\n", n_groups);
    if (n_groups < 3) {
        fprintf(stderr, "Need at least 3 groups\n");
        return 1;
    }

    // Calibrate each camera individually (get intrinsics)
    Mat K[3], D[3];
    vector<Mat> rvecs[3], tvecs[3];
    for (int i = 0; i < 3; i++) {
        double rms = calibrateCamera(objpts[i], imgpts[i], img_size,
                                      K[i], D[i], rvecs[i], tvecs[i],
                                      CALIB_FIX_PRINCIPAL_POINT);
        fprintf(stderr, "Camera %d RMS=%.4f fx=%.1f cy=%.1f\n", i, rms,
                K[i].at<double>(0,0), K[i].at<double>(1,2));
    }

    // Compute per-view relative poses and filter outliers
    // Expected baseline ~75mm for LC,CR; ~150mm for LR
    vector<int> inlier_idx[2]; // 0=LC, 1=CR
    double base_LC = 75.0, base_CR = 75.0;
    double bl_thresh = 20.0; // mm tolerance

    for (int g = 0; g < n_groups; g++) {
        // LC pair
        {
            Mat R0, R1;
            Rodrigues(rvecs[0][g], R0);
            Rodrigues(rvecs[1][g], R1);
            Mat R_rel = R1 * R0.t();
            Mat T_rel = tvecs[1][g] - R_rel * tvecs[0][g];
            double bl = norm(T_rel);
            if (fabs(bl - base_LC) < bl_thresh && fabs(T_rel.at<double>(1)) < 30 && fabs(T_rel.at<double>(2)) < 30)
                inlier_idx[0].push_back(g);
        }
        // CR pair
        {
            Mat R1, R2;
            Rodrigues(rvecs[1][g], R1);
            Rodrigues(rvecs[2][g], R2);
            Mat R_rel = R2 * R1.t();
            Mat T_rel = tvecs[2][g] - R_rel * tvecs[1][g];
            double bl = norm(T_rel);
            if (fabs(bl - base_CR) < bl_thresh && fabs(T_rel.at<double>(1)) < 30 && fabs(T_rel.at<double>(2)) < 30)
                inlier_idx[1].push_back(g);
        }
    }

    fprintf(stderr, "\nInliers: LC=%d CR=%d (total %d)\n",
            (int)inlier_idx[0].size(), (int)inlier_idx[1].size(), n_groups);

    if (inlier_idx[0].size() < 5 || inlier_idx[1].size() < 5) {
        fprintf(stderr, "Not enough inliers\n");
        return 1;
    }

    // Build inlier-only data for each stereo pair (separate copies)
    vector<vector<Point3f>> obj_lc[2];
    vector<vector<Point2f>> img_lc[2];
    for (int gi : inlier_idx[0]) {
        obj_lc[0].push_back(objpts[0][gi]);
        img_lc[0].push_back(imgpts[0][gi]);
        obj_lc[1].push_back(objpts[1][gi]);
        img_lc[1].push_back(imgpts[1][gi]);
    }
    vector<vector<Point3f>> obj_cr[2];
    vector<vector<Point2f>> img_cr[2];
    for (int gi : inlier_idx[1]) {
        obj_cr[0].push_back(objpts[1][gi]);
        img_cr[0].push_back(imgpts[1][gi]);
        obj_cr[1].push_back(objpts[2][gi]);
        img_cr[1].push_back(imgpts[2][gi]);
    }

    // Stereo calibrate with inliers
    Mat R_lc, T_lc, R_cr, T_cr;
    double rms_lc = 0, rms_cr = 0;

    {
        TermCriteria crit(TermCriteria::COUNT + TermCriteria::EPS, 200, 1e-6);
        int flags = CALIB_FIX_INTRINSIC | CALIB_FIX_FOCAL_LENGTH | CALIB_FIX_PRINCIPAL_POINT;
        rms_lc = stereoCalibrate(obj_lc[0], img_lc[0], img_lc[1],
                                  K[0], D[0], K[1], D[1], img_size,
                                  R_lc, T_lc, noArray(), noArray(),
                                  noArray(), noArray(), noArray(), flags, crit);
        fprintf(stderr, "LC stereo: RMS=%.4f bl=%.1f\n", rms_lc, norm(T_lc));
    }
    {
        TermCriteria crit(TermCriteria::COUNT + TermCriteria::EPS, 200, 1e-6);
        int flags = CALIB_FIX_INTRINSIC | CALIB_FIX_FOCAL_LENGTH | CALIB_FIX_PRINCIPAL_POINT;
        rms_cr = stereoCalibrate(obj_cr[0], img_cr[0], img_cr[1],
                                  K[1], D[1], K[2], D[2], img_size,
                                  R_cr, T_cr, noArray(), noArray(),
                                  noArray(), noArray(), noArray(), flags, crit);
        fprintf(stderr, "CR stereo: RMS=%.4f bl=%.1f\n", rms_cr, norm(T_cr));
    }

    // Output JSON to stdout
    auto mat_to_json = [](const Mat& m) -> string {
        string s = "[";
        for (int r = 0; r < m.rows; r++) {
            if (r > 0) s += ",";
            s += "[";
            for (int c = 0; c < m.cols; c++) {
                if (c > 0) s += ",";
                char buf[32];
                snprintf(buf, sizeof(buf), "%.10f", m.at<double>(r, c));
                s += buf;
            }
            s += "]";
        }
        return s + "]";
    };
    auto vec_to_json = [](const Mat& v) -> string {
        string s = "[";
        for (int i = 0; i < v.rows * v.cols; i++) {
            if (i > 0) s += ",";
            char buf[32];
            snprintf(buf, sizeof(buf), "%.10f", v.at<double>(i));
            s += buf;
        }
        return s + "]";
    };

    printf("{\n");
    printf("  \"ok\": true,\n");
    printf("  \"frames\": %d,\n", n_groups);
    printf("  \"lc_inliers\": %d,\n", (int)inlier_idx[0].size());
    printf("  \"cr_inliers\": %d,\n", (int)inlier_idx[1].size());
    printf("  \"cameras\": [\n");
    for (int i = 0; i < 3; i++) {
        printf("    {\"K\":%s,\"D\":%s}%s\n",
               mat_to_json(K[i]).c_str(), vec_to_json(D[i]).c_str(),
               i < 2 ? "," : "");
    }
    printf("  ],\n");
    printf("  \"stereo\": [\n");
    printf("    {\"pair\":\"left_center\",\"R\":%s,\"T\":%s,\"baseline_mm\":%.1f,\"rms\":%.4f},\n",
           mat_to_json(R_lc).c_str(), vec_to_json(T_lc).c_str(), norm(T_lc), rms_lc);
    printf("    {\"pair\":\"center_right\",\"R\":%s,\"T\":%s,\"baseline_mm\":%.1f,\"rms\":%.4f}\n",
           mat_to_json(R_cr).c_str(), vec_to_json(T_cr).c_str(), norm(T_cr), rms_cr);
    printf("  ]\n");
    printf("}\n");

    return 0;
}

