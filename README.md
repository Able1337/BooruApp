# Booru Pocket

Сайт по IP: **https://109.120.140.198/** — работает в Chrome без APK. Доменный адрес: https://frank.eben-grad.ru/.

Для IP выпущен отдельный доверенный сертификат. Его автоматическое продление проверяется каждые четыре часа. API разрешает только явно указанные адреса домена и IP; остальные Origin по-прежнему отклоняются. HTTPS и реальный API-запрос к Safebooru по IP проверены workflow Deploy server без отключения проверки сертификата.

## Интерфейс 0.3

- Несколько сохранённых booru и быстрый выбор источника перед строкой поиска.
- Готовые шаблоны Rule34, Gelbooru, Danbooru, e621 и Safebooru с заполненными адресами.
- Поиск остаётся сверху в ленте. Подсказки тегов, плашки включённых/исключённых тегов и подсказки фильтров `score`, `sort` и `order`.
- Карточки источников и коллекций тегов на главной. Коллекция сохраняет запрос, источник и сортировку. Сохранённые публикации находятся отдельно в разделе «Посты».
- Крупная лента показывает пост и категории тегов непосредственно в карточке. В режиме плитки превью открывает просмотрщик. Выбор вида сохраняется.
- Категории автора, персонажа, вселенной, общих и служебных тегов; дополнительные группы e621. Если API не сообщает тип тега, он отображается в общей группе.
- Старые настройки `bp.source` и избранные посты переносятся автоматически. Экспорт библиотеки включает источники, коллекции и посты, но не API-ключи.

Фильтр `score:>100` задаёт минимальную оценку. Для DAPI используется `sort:score:desc`, для Danbooru/e621 — `order:score`. Список сортировки формирует нужный запрос автоматически; явно введённый фильтр сортировки также поддерживается.

Автоматические проверки: `npm test`. Проверка реального браузера использует `scripts/ui-smoke.mjs` с отдельной временной установкой Playwright: десктоп 1280px и мобильный экран 390px, несколько источников, подсказки, коллекции, оба вида ленты, просмотрщик, сохранение постов и отсутствие горизонтального переполнения. Тестовые изображения нейтральные и не загружаются из booru.

## Как работает

HTML/CSS/JavaScript интерфейс сохранён. Node-сервер без npm-зависимостей обслуживает страницу и передаёт запросы API через `POST /api/posts` на том же домене. Это снимает зависимость браузерных API-запросов от CORS источника. Картинки, GIF и видео загружаются непосредственно из источников.

Поддержаны Safebooru (по умолчанию), Rule34, Gelbooru, Danbooru и e621. Сервер разрешает только запросы списка публикаций и подсказок тегов к этим API, ограничивает объём ответа, время ожидания, частоту и число параллельных запросов. Произвольные адреса и редиректы запрещены.

Избранное и настройки сохраняются в localStorage браузера. Ключ API передаётся серверу для запроса к источнику, но сервер не сохраняет его на диск и не пишет тела запросов в логи. Используйте только HTTPS. При переходе с APK или другого домена нужно заново задать источник и импортировать ранее экспортированное избранное.

## Подключить Rule34

В настройках укажите адрес `https://rule34.xxx/` или `https://api.rule34.xxx/`, формат **Gelbooru / DAPI**, свои **User ID** и **API key** из раздела **API Access Credentials** аккаунта. Вставляйте только значения, без `api_key=`, `user_id=` и остальных частей URL. Адрес API выбирается автоматически. Ключи не коммитить и не передавать в issues.

## Проверено 2026-11-04

- HTTPS и `/healthz` на публичном домене отвечают.
- Реальный запрос браузерного серверного API к Safebooru вернул список публикаций.
- Первоначальная серверная версия прошла 16 автоматических тестов локально, в Actions и на сервере, включая запуск через ссылку на текущую версию, POST API, запрет чужого Origin/произвольных адресов и сохранение ключа вне URL браузерного запроса.
- Xray остановлен, его автозапуск и управляющая панель отключены, исполняемые файлы убраны из рабочих путей. Приватная резервная копия находится в `/root/booru-before-xray-removal/` на сервере.
- Rule34 с пользовательским ключом и реальный просмотр на телефоне ещё не подтверждены.

GitHub Pages больше не используется. Workflow публикации Pages удалён. Полное снятие старой публикации выполняется через Settings → Pages → Unpublish site: GitHub API интеграции отказал в этом действии (403).

## Развёртывание

См. [инструкцию сервера](deploy/README.md). Установка использует systemd, nginx и Certbot; приложение работает от отдельного пользователя `booru-pocket`, доступен только loopback-порт 18737. Публичный HTTPS использует 443. Автопродление сертификата включено.

Ручной workflow **Deploy server** использует `BOORU_DEPLOY_PASSWORD` из Repository secrets. После разового развёртывания удалите этот временный секрет. Пароль сервера не входит в код, APK, архивы проекта или коммиты.

## Разработка

```sh
npm test
npm start
```

Node 18+ для сервера, Node 22 в CI. Для локального HTTP допускается отсутствие `PUBLIC_ORIGIN`; на сервере выставлено `PUBLIC_ORIGIN=https://frank.eben-grad.ru`.

## Android (необязательный клиент)

Исходная Java/WebView оболочка сохранена. Её API-запросы выполняются нативно. Браузерный сайт не требует установки приложения.

## Reproducible build steps

Requires JDK 17, Android SDK platform 35 and build-tools 35.0.0, `zip`, and Node 22 for the tests. No Gradle or npm install is needed.

```sh
sdkmanager 'platforms;android-35' 'build-tools;35.0.0'
npm test
export ANDROID_SDK_ROOT=/path/to/android-sdk
bash scripts/build-apk.sh
```

Output: `build/BooruPocket.apk`. The build compiles resources with AAPT2, Java with the JDK compiler, bytecode with D8, aligns the APK, signs it, and verifies the signature. The APK has no native ABI-specific libraries.

Without a configured key, a development key is generated in `build/debug.keystore`. Keep that file private and preserve it for subsequent local builds. GitHub runners generate a new development key per run unless persistent signing secrets are configured.

Optional GitHub Actions secrets for stable signing:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Base64-encoded private keystore |
| `ANDROID_KEY_ALIAS` | Alias in the keystore |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_PASSWORD` | Key password |

For local stable signing, set `BOORU_KEYSTORE`, `BOORU_KEY_ALIAS`, `BOORU_KEYSTORE_PASSWORD`, and `BOORU_KEY_PASSWORD`. Do not commit private keystores.

## Local web development

```sh
npm run serve
```

Open `http://localhost:8080`. Browser API calls depend on source CORS. `npm test` checks pagination, tag/credential escaping, both JSON formats, unsafe and missing URL rejection, favorites validation, and a simulated native-port/viewer/favorites flow. See VALIDATION.md for the scope of verification.


APK из разных сборок без постоянного ключа подписаны разными ключами и не обновляют друг друга. Для обновления установленной v0.1 нужен оригинальный приватный ключ. Не коммитьте keystore.
