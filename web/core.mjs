export function httpsUrl(value, base) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try { const u = new URL(value, base); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}
export function makeRequest(source, tags, page, limit = 30) {
  const base = httpsUrl(source.base);
  if (!base) throw new Error('Адрес источника должен начинаться с https://');
  const apiBase = new URL(base);
  // Rule34 serves DAPI on a separate host; keep source.base for post links and favorite keys.
  if (source.kind === 'gelbooru' && ['rule34.xxx', 'www.rule34.xxx'].includes(apiBase.hostname)) {
    apiBase.hostname = 'api.rule34.xxx';
  }
  if (source.kind === 'gelbooru' && apiBase.hostname === 'api.rule34.xxx') {
    if (!source.userId || !source.apiKey) throw new Error('Rule34 требует User ID и API key из раздела API Access Credentials в настройках аккаунта.');
    if (!/^\d+$/.test(source.userId) || /(?:api_key|user_id)=|\s/.test(source.apiKey)) {
      throw new Error('Введи только значения User ID и API key, без api_key=, user_id=, пробелов и частей URL.');
    }
  }
  const apiRoot = apiBase.href;
  const u = new URL(source.kind === 'danbooru' ? 'posts.json' : 'index.php', apiRoot.endsWith('/') ? apiRoot : apiRoot + '/');
  if (source.kind === 'danbooru') {
    u.searchParams.set('page', String(page + 1));
  } else {
    for (const [key, value] of Object.entries({page:'dapi', s:'post', q:'index', json:'1', pid:String(page)})) u.searchParams.set(key, value);
  }
  u.searchParams.set('limit', String(limit));
  u.searchParams.set('tags', tags.trim());
  if (source.userId) u.searchParams.set('user_id', source.userId);
  if (source.apiKey) u.searchParams.set('api_key', source.apiKey);
  return u.href;
}
export function postRows(payload) {
  // Never display raw API errors: providers may echo credential-bearing request URLs.
  const errors = payload && !Array.isArray(payload) ? [payload.error, payload.message, payload.reason, payload['@attributes']?.reason] : [];
  const text = errors.filter(v => typeof v === 'string').join(' ').toLowerCase();
  if (/auth|api.?key|user.?id|credential|access denied|unauthorized|forbidden/.test(text)) {
    throw new Error('API отклонил авторизацию. Проверь пару User ID и API key в API Access Credentials своего аккаунта.');
  }
  if (/rate|too many|limit exceeded/.test(text)) throw new Error('Превышен лимит запросов API. Подожди минуту и повтори.');
  if (/search down|overload|maintenance/.test(text)) throw new Error('Поиск источника временно недоступен. Повтори позже.');
  if (text || payload?.success === false || payload?.success === 'false') throw new Error('API вернул сообщение об ошибке вместо списка публикаций. Проверь доступ API в аккаунте источника.');
  const rows = Array.isArray(payload) ? payload : payload?.post ?? payload?.posts;
  if (!Array.isArray(rows)) throw new Error('Источник вернул неожиданный формат данных');
  return rows;
}
export function normalizePosts(payload, source) {
  return postRows(payload).filter(p => p && typeof p === 'object' && p.id != null).map(p => {
    const file = httpsUrl(p.file_url || p.large_file_url, source.base);
    const preview = httpsUrl(p.preview_file_url || p.preview_url || p.sample_url || p.file_url, source.base);
    const sample = httpsUrl(p.sample_url || p.large_file_url || p.file_url, source.base);
    const ext = String(p.file_ext || file.split('?')[0].split('.').pop() || '').toLowerCase();
    const tags = String(p.tag_string || p.tags || '').split(/\s+/).filter(Boolean);
    return {id:String(p.id), key:source.base+'#'+p.id, file, preview, sample, tags,
      width:Number(p.image_width || p.width)||800, height:Number(p.image_height || p.height)||1000,
      video:['mp4','webm'].includes(ext), rating:p.rating || '', source:source.name,
      page:source.kind === 'danbooru' ? new URL('posts/'+p.id, source.base).href : new URL('index.php?page=post&s=view&id='+encodeURIComponent(p.id), source.base).href};
  }).filter(p => p.id !== 'undefined' && p.preview && p.file);
}

export function sanitizeFavorites(data) {
  if (!Array.isArray(data)) throw new Error('Ожидается массив публикаций');
  return [...new Map(data.filter(p => p && typeof p.key === 'string' && typeof p.id === 'string' && httpsUrl(p.file) && httpsUrl(p.preview) && Array.isArray(p.tags) && p.tags.every(t => typeof t === 'string')).map(p => [p.key, {...p, file:httpsUrl(p.file), preview:httpsUrl(p.preview), sample:httpsUrl(p.sample) || httpsUrl(p.file), video:!!p.video}])).values()];
}
