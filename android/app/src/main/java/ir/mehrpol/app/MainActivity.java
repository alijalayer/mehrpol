package ir.mehrpol.app;

import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.widget.Toast;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final String APK_TYPE = "application/vnd.android.package-archive";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // The WebView cannot save files itself. Downloads go through Android's download manager:
        // a progress notification, the file in the Downloads folder, and for a new version of this
        // app, the installer opens as soon as the download finishes.
        getBridge().getWebView().setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) ->
            download(url, contentDisposition, mimeType));
    }

    private void download(String url, String contentDisposition, String mimeType) {
        String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
        boolean apk = APK_TYPE.equals(mimeType) || name.endsWith(".apk");
        try {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url))
                .setTitle(name)
                .setDescription(getString(R.string.app_name))
                .setMimeType(apk ? APK_TYPE : mimeType)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            String cookies = CookieManager.getInstance().getCookie(url);
            if (cookies != null) request.addRequestHeader("cookie", cookies);
            DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            long id = manager.enqueue(request);
            Toast.makeText(this, "دانلود شروع شد؛ پیشرفتش را در نوار اعلان‌ها ببینید.", Toast.LENGTH_LONG).show();
            if (apk) installWhenDone(manager, id);
        } catch (Exception e) {
            // No download manager or no storage access: let the phone's browser handle it.
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            } catch (ActivityNotFoundException ignored) {
                Toast.makeText(this, "دانلود انجام نشد؛ لطفاً دوباره امتحان کنید.", Toast.LENGTH_LONG).show();
            }
        }
    }

    /** Opens the system installer for the downloaded APK, which installs it over this version. */
    private void installWhenDone(DownloadManager manager, long id) {
        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1) != id) return;
                try {
                    unregisterReceiver(this);
                } catch (IllegalArgumentException ignored) {
                    // Already unregistered.
                }
                Uri file = manager.getUriForDownloadedFile(id);
                if (file == null) {
                    Toast.makeText(MainActivity.this, "دانلود کامل نشد؛ دوباره امتحان کنید.", Toast.LENGTH_LONG).show();
                    return;
                }
                Intent install = new Intent(Intent.ACTION_VIEW)
                    .setDataAndType(file, APK_TYPE)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    startActivity(install);
                } catch (ActivityNotFoundException ignored) {
                    Toast.makeText(MainActivity.this, "فایل در پوشهٔ Downloads ذخیره شد؛ از همان‌جا نصبش کنید.", Toast.LENGTH_LONG).show();
                }
            }
        };
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED);
        else registerReceiver(receiver, filter);
    }
}
