# Straightforward Lawn App (Personal) — Email Version

This is your personal, offline-first lawn estimating + today-only schedule app.

## Email notifications (replies come to you)
This build uses `expo-mail-composer` to open your phone’s email app with a pre-filled message.
- Sender: your own mailbox (e.g. info@straightforwardlawncare.co.nz)
- Replies: go back to you normally
- Note: This does *not* auto-send emails in the background (it opens the email draft so you can press Send).

## Run on your phone (Expo Go)
1. Install Node.js on a computer.
2. In a terminal:
   ```bash
   npm install -g expo
   cd straightforward-lawn-app
   npm install
   npx expo start
   ```
3. On your Samsung A26, install **Expo Go** from Google Play.
4. Scan the QR code.

## Make an installable Android app (APK/AAB)
Use EAS Build:
```bash
npm install -g eas-cli
eas login
eas build:configure
eas build -p android --profile preview
```



## Branding (use your logo)
To use your chosen Straightforward Lawn Care logo:

1. Save your logo image to your computer (or phone).
2. Replace these files in `assets/` (same filenames):
   - `assets/icon.png`  (app icon — square image recommended)
   - `assets/splash.png` (splash screen — any large image works)

**Tips**
- `icon.png`: best as a square PNG (at least 1024×1024).
- `splash.png`: best as a large PNG (at least 1600×1600). Keep the logo centered with some padding.
- After replacing images, restart Expo with cache clear:
  - `npx expo start -c`

The app header also shows `assets/icon.png` as the brand logo.
## Go live checklist (quick)
### 1) Test on your phone
- `npx expo start -c`
- Open in **Expo Go**
- Add 1 job, export CSV, email a test job to yourself

### 2) Build an installable APK (share / sideload)
```bash
npm install -g eas-cli
eas login
eas build:configure
npm run build:apk
```
When the build finishes, EAS gives you a download link for the APK.

### 3) Production Play Store AAB (optional)
```bash
npm run build:aab
```
This outputs an Android App Bundle for Google Play.

## Common fixes
- If the app won’t pick photos: check **Settings → Apps → Straightforward Lawn → Permissions**
- If Email buttons do nothing: make sure an email account is added on your phone, and Gmail is enabled as the default email app.
- If Expo says “SDK mismatch”: update Expo Go from the Play Store, then `npx expo start -c`
