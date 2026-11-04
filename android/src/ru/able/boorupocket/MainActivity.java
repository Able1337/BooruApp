package ru.able.boorupocket;

import android.app.*;
import android.os.*;
import android.content.*;
import android.graphics.Color;
import android.net.Uri;
import android.webkit.*;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

public class MainActivity extends Activity {
    private static final String LOCAL="https://appassets.androidplatform.net/";
    private static final String REMOTE="https://frank.eben-grad.ru/";
    private static final int FILE_PICK=10, EXPORT=11, MAX_BYTES=4*1024*1024;
    private WebView web;
    private WebMessagePort nativePort;
    private int session=0;
    private final ThreadPoolExecutor workers=new ThreadPoolExecutor(4,4,30,TimeUnit.SECONDS,new ArrayBlockingQueue<Runnable>(24));
    private ValueCallback<Uri[]> fileCallback;
    private String pendingExport;
    private boolean fallingBack=false;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(18,16,22));
        getWindow().setNavigationBarColor(Color.rgb(18,16,22));
        LinearLayout layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);layout.setBackgroundColor(Color.rgb(18,16,22));
        layout.setOnApplyWindowInsetsListener((v,insets)->{v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets.consumeSystemWindowInsets();});
        LinearLayout toolbar=new LinearLayout(this);toolbar.setGravity(Gravity.CENTER_VERTICAL);
        TextView label=new TextView(this);label.setText("Booru Pocket");label.setTextColor(Color.rgb(214,181,250));label.setTextSize(14);label.setPadding(24,8,8,8);toolbar.addView(label,new LinearLayout.LayoutParams(0,48,1));
        Button mode=new Button(this);mode.setText("Интерфейс");mode.setTextSize(11);mode.setOnClickListener(v->chooseMode());toolbar.addView(mode);
        layout.addView(toolbar);
        web=new WebView(this);web.setBackgroundColor(Color.rgb(18,16,22));
        WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);settings.setSupportMultipleWindows(false);
        android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        web.setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                Uri u=request.getUrl();
                if(!"appassets.androidplatform.net".equals(u.getHost()))return null;
                String path=u.getPath();String file=path==null||path.equals("/")?"index.html":path.substring(1);
                if(!Arrays.asList("index.html","app.mjs","core.mjs","style.css").contains(file))return new WebResourceResponse("text/plain","UTF-8",404,"Not Found",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));
                try{String mime=file.endsWith(".mjs")?"text/javascript":file.endsWith(".css")?"text/css":"text/html";return new WebResourceResponse(mime,"UTF-8",getAssets().open("web/"+file));}catch(IOException e){return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));}
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                String url=request.getUrl().toString();
                if(request.isForMainFrame()&&trusted(url))return false;
                if(request.isForMainFrame()&&"https".equals(request.getUrl().getScheme()))openExternal(request.getUrl());
                return true;
            }
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon){session++;if(nativePort!=null){nativePort.close();nativePort=null;}}
            @Override public void onPageFinished(WebView view,String url){if(trusted(url)&&url.equals(view.getUrl()))attachPort(url);}
            @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){if(request.isForMainFrame())fallback();}
            @Override public void onReceivedHttpError(WebView view,WebResourceRequest request,WebResourceResponse response){if(request.isForMainFrame()&&response.getStatusCode()>=400)fallback();}
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){
                if(fileCallback!=null)fileCallback.onReceiveValue(null);fileCallback=callback;
                Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);intent.setType("application/json");intent.addCategory(Intent.CATEGORY_OPENABLE);
                try{startActivityForResult(intent,FILE_PICK);}catch(ActivityNotFoundException e){fileCallback.onReceiveValue(null);fileCallback=null;}return true;
            }
            @Override public boolean onJsAlert(WebView view,String url,String message,JsResult result){new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("ОК",(d,w)->result.confirm()).setOnCancelListener(d->result.cancel()).show();return true;}
        });
        web.setDownloadListener((url,ua,cd,mime,length)->{if(url.startsWith("https://"))openExternal(Uri.parse(url));});
        layout.addView(web,new LinearLayout.LayoutParams(-1,0,1));setContentView(layout);
        // Bundled by default: works before Pages is enabled and has an offline UI.
        web.loadUrl(getPreferences(0).getBoolean("remote",false)?REMOTE:LOCAL);
    }
    private boolean trusted(String url){return url!=null&&(url.equals(LOCAL)||url.equals(LOCAL+"index.html")||url.equals(REMOTE)||url.equals(REMOTE+"index.html"));}
    private void chooseMode(){new AlertDialog.Builder(this).setTitle("Откуда загружать интерфейс?").setItems(new String[]{"Из APK — автономный интерфейс","Сайт — обновления интерфейса","Перезагрузить"},(d,which)->{if(which<2){getPreferences(0).edit().putBoolean("remote",which==1).apply();fallingBack=false;web.loadUrl(which==1?REMOTE:LOCAL);}else web.reload();}).show();}
    private void fallback(){if(!fallingBack&&web.getUrl()!=null&&web.getUrl().startsWith(REMOTE)){fallingBack=true;web.post(()->{Toast.makeText(this,"Сайт пока недоступен. Открываем встроенную версию.",Toast.LENGTH_LONG).show();web.loadUrl(LOCAL);});}}
    private void openExternal(Uri uri){try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(ActivityNotFoundException e){Toast.makeText(this,"Не найден браузер",Toast.LENGTH_SHORT).show();}}
    private void attachPort(String url){
        if(nativePort!=null)nativePort.close();
        final int currentSession=session;
        WebMessagePort[] channel=web.createWebMessageChannel();nativePort=channel[0];
        final WebMessagePort reply=channel[0];
        reply.setWebMessageCallback(new WebMessagePort.WebMessageCallback(){@Override public void onMessage(WebMessagePort port,WebMessage message){
            if(currentSession!=session||!trusted(web.getUrl()))return;
            try{
                JSONObject request=new JSONObject(message.getData());String id=request.optString("id");if(!id.matches("[0-9]{1,12}"))return;
                if("export".equals(request.optString("op"))){exportJson(request.optString("body"));respond(reply,currentSession,id,"{}",null);return;}
                final String target=request.getString("url");
                try{workers.execute(()->{try{respond(reply,currentSession,id,fetch(target),null);}catch(Exception e){respond(reply,currentSession,id,null,e instanceof SocketTimeoutException?"Время ожидания API истекло":"Не удалось получить ответ API. Проверь адрес, доступ к сети и ключ API.");}});}catch(RejectedExecutionException e){respond(reply,currentSession,id,null,"Слишком много запросов. Попробуй через несколько секунд.");}
            }catch(Exception ignored){}
        }});
        Uri u=Uri.parse(url);String origin=u.getScheme()+"://"+u.getAuthority();
        web.postWebMessage(new WebMessage("booru-native-v1",new WebMessagePort[]{channel[1]}),Uri.parse(origin));
    }
    private void respond(WebMessagePort port,int expected,String id,String body,String error){runOnUiThread(()->{if(expected!=session||!trusted(web.getUrl()))return;try{JSONObject r=new JSONObject();r.put("id",id);if(error==null)r.put("body",body);else r.put("error",error);port.postMessage(new WebMessage(r.toString()));}catch(Exception ignored){}});}
    private static URL checkedUrl(String target)throws Exception{
        URL u=new URL(target);
        if(!"https".equals(u.getProtocol())||u.getUserInfo()!=null||(u.getPort()!=-1&&u.getPort()!=443)||target.length()>8192)throw new IOException("Invalid URL");
        for(InetAddress ip:InetAddress.getAllByName(u.getHost()))if(ip.isAnyLocalAddress()||ip.isLoopbackAddress()||ip.isLinkLocalAddress()||ip.isSiteLocalAddress()||ip.isMulticastAddress()||(ip.getAddress().length==16&&((ip.getAddress()[0]&0xfe)==0xfc)))throw new IOException("Private destination");
        return u;
    }
    private static String fetch(String target)throws Exception{
        URL u=checkedUrl(target);
        for(int redirect=0;redirect<4;redirect++){
            HttpURLConnection c=(HttpURLConnection)u.openConnection();c.setConnectTimeout(12000);c.setReadTimeout(20000);c.setInstanceFollowRedirects(false);c.setRequestProperty("Accept","application/json");c.setRequestProperty("User-Agent","BooruPocket/0.1.1 (Android; personal API client)");
            try{int status=c.getResponseCode();if(status>=300&&status<400){String location=c.getHeaderField("Location");URL next=checkedUrl(new URL(u,location).toString());if(!u.getHost().equalsIgnoreCase(next.getHost())&&u.getQuery()!=null)throw new IOException("Cross-host redirect with query");u=next;continue;}
                if(status<200||status>=300)throw new IOException("HTTP "+status);
                try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
                    byte[] buf=new byte[8192];int n,total=0;while((n=in.read(buf))!=-1){total+=n;if(total>MAX_BYTES)throw new IOException("Response too large");out.write(buf,0,n);}return out.toString("UTF-8");
                }
            }finally{c.disconnect();}
        }throw new IOException("Too many redirects");
    }
    private void exportJson(String body){if(pendingExport!=null){Toast.makeText(this,"Сначала заверши текущее сохранение",Toast.LENGTH_SHORT).show();return;}if(body.getBytes(StandardCharsets.UTF_8).length>5*1024*1024){Toast.makeText(this,"Файл больше 5 МБ",Toast.LENGTH_LONG).show();return;}pendingExport=body;Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("application/json");i.putExtra(Intent.EXTRA_TITLE,"booru-pocket-favorites.json");try{startActivityForResult(i,EXPORT);}catch(ActivityNotFoundException e){pendingExport=null;}}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);
        if(request==FILE_PICK&&fileCallback!=null){fileCallback.onReceiveValue(result==RESULT_OK&&data!=null&&data.getData()!=null?new Uri[]{data.getData()}:null);fileCallback=null;}
        if(request==EXPORT){String content=pendingExport;pendingExport=null;if(result==RESULT_OK&&data!=null&&data.getData()!=null&&content!=null){try(OutputStream out=getContentResolver().openOutputStream(data.getData())){out.write(content.getBytes(StandardCharsets.UTF_8));Toast.makeText(this,"Избранное сохранено",Toast.LENGTH_SHORT).show();}catch(Exception e){Toast.makeText(this,"Не удалось сохранить файл",Toast.LENGTH_LONG).show();}}}
    }
    @Override public void onBackPressed(){web.evaluateJavascript("(()=>{const d=document.querySelector('dialog[open]');if(d){d.close();return true;}if(location.hash.startsWith('#feed')||location.hash.startsWith('#saved')){history.back();return true;}return false;})()",value->{if(!"true".equals(value))new AlertDialog.Builder(this).setMessage("Закрыть приложение?").setPositiveButton("Закрыть",(d,w)->finish()).setNegativeButton("Отмена",null).show();});}
    @Override protected void onDestroy(){session++;workers.shutdownNow();if(nativePort!=null)nativePort.close();if(fileCallback!=null)fileCallback.onReceiveValue(null);web.destroy();super.onDestroy();}
}
