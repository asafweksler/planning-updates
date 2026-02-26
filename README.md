# דשבורד עדכוני תכנון (MVP) — Deploy ל-Netlify

מה יש כאן?
- Frontend (React + Tailwind) שמציג רשימות של תכניות שהשתנו לאחרונה
- Netlify Functions:
  - `updates`  → `GET /api/updates?days=30`
  - `sync-xplan` → `POST /api/sync` (סנכרון עכשיו)
  - `sync-daily` → Scheduled Function שרצה פעם ביום (UTC)
- Netlify Blobs לשמירת snapshot + אירועים (persist בין deploys)

## דרישות
- Node 18+ (מומלץ)
- חשבון Netlify

## הרצה מקומית
```bash
npm install
npm run netlify:dev
```

פתח בדפדפן את הכתובת שמופיעה בטרמינל.

## Deploy ל-Netlify (הכי פשוט)
1) העלה את הפרויקט ל-GitHub
2) ב-Netlify: New site from Git → בחר את הריפו
3) Build command: `npm run build` (כבר בקובץ netlify.toml)
4) Publish directory: `dist` (כבר בקובץ netlify.toml)
5) Deploy

## הגדרות (אופציונלי)
הכל אמור לעבוד עם ברירת מחדל, אבל אם צריך לכייל:
- `XPLAN_QUERY_URL` — כתובת ArcGIS Query של שכבת XPLAN (ברירת מחדל קיימת)
- `SYNC_LOOKBACK_DAYS` — כמה ימים אחורה להביא (ברירת מחדל 30)
- `XPLAN_MAX_PAGES` — מספר דפים מקסימלי למשיכה (ברירת מחדל 8)
- שדות override (אם autodetect לא פוגע בול):
  - `XPLAN_PLAN_NUMBER_FIELD`
  - `XPLAN_PLAN_NAME_FIELD`
  - `XPLAN_STATUS_FIELD`
  - `XPLAN_CHANGED_AT_FIELD`
  - `XPLAN_CITY_FIELD`
  - `XPLAN_DISTRICT_FIELD`
  - `XPLAN_COMMITTEE_FIELD`

## איך זה עובד
- `sync-xplan` מושך רשומות עדכניות מ-XPLAN (ArcGIS), מזהה תכניות חדשות/שינוי סטטוס/שינוי כללי,
  ושומר אירועים בקובץ יומי ב-Blobs (`daily-events/events/YYYY-MM-DD.json`).
- `updates` קורא את קבצי הימים האחרונים ומחזיר רשימת עדכונים ל-UI.

בהצלחה — ואם אתה רוצה, השלב הבא הוא להוסיף:
- פילטר לפי עיר/ועדה, ו-watchlist עם התראות מייל/טלגרם.


## קישורים
- אם נמצא מזהה MAVAT בנתוני XPLAN, הקישור בכרטיס יוביל ל-MAVAT (מידע תכנוני).
- אחרת, הקישור יוביל ל-XPLAN.


## פתרון תקלות
- אם `/api/sync` מחזיר HTTP 502: לרוב זו קריסה של function. בדוק ב-Netlify → Functions → `sync-xplan` → Logs.
- ודא שהפרויקט רץ על Node 20 (יש `.nvmrc` ו-`NODE_VERSION=20`).
