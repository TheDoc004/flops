# App Store / Capacitor path (after HTTPS phone browser works)

Do **not** start this until [`docs/deploy-checklist.md`](./deploy-checklist.md) is complete and login works on phone Safari.

Order: **phone browser → Capacitor + HealthKit → TestFlight → App Store**.

## You must do (Apple / legal / accounts)

1. Enroll in the **Apple Developer Program** ($99/year).
2. Create an App ID; enable **Sign in with Apple** and (later) **HealthKit**.
3. Create certificates + provisioning profiles (Xcode / Certificates portal).
4. Host a **Privacy Policy** and **Terms** URL (required for App Store + Sign in with Apple).
5. Create the app in **App Store Connect** (bundle id, screenshots, description, age rating, export compliance).
6. Upload builds via Xcode / Transporter; use **TestFlight** first (internal, then external ≤10k; builds expire ~90 days).
7. Submit for App Review when the build has clear native value (HealthKit / polished UX) — avoid Guideline 4.2 “thin wrapper” risk.

## Code / agent later (not day-one)

- Capacitor wrap of the Vite client; commit `ios/` project.
- Real Apple identity-token verification on the server (`APPLE_CLIENT_ID`).
- HealthKit read path (weight / workouts) with user consent.
- StoreKit / RevenueCat only if you monetize.

## Success checks

- TestFlight install logs meals against the **production** API.
- Sign in with Apple works on device (email OTP remains fallback on web).
- HealthKit optional reads do not block core logging.
