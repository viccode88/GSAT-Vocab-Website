export default {
    async fetch(request, env, ctx) {
      // 從請求的 URL 中解析出路徑
      const url = new URL(request.url);
      const objectKey = url.pathname.slice(1); // 移除開頭的 "/"
  
      // 1. 基本的安全性與有效性檢查
      if (request.method !== 'GET') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      if (!objectKey || !objectKey.endsWith('.mp3')) {
        return new Response('Invalid request. Please request an .mp3 file.', {
          status: 400,
        });
      }
  
      // 2. 從 R2 儲存桶中獲取對應的物件 (音檔)
      const object = await env.AUDIO_BUCKET.get(objectKey);
  
      // 如果找不到檔案
      if (object === null) {
        return new Response(`Object Not Found: ${objectKey}`, { status: 404 });
      }
  
      // 3. 建立帶有正確標頭的回應
      const headers = new Headers();
      object.writeHttpMetadata(headers); // 自動寫入 Content-Type, ETag 等元數據
      headers.set('etag', object.httpEtag);
      headers.set('cache-control', 'public, max-age=2592000'); // 快取 30 天
  
      // 4. 回傳帶有音檔內容的回應
      return new Response(object.body, {
        headers,
      });
    },
  };