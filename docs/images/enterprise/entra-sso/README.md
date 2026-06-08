# Entra SSO screenshots

Checklist and capture instructions for the 11 screenshots referenced in
`docs/enterprise/security/entra-sso.mdx`. Drop the finished PNGs into this
folder using the exact filenames below. Each screenshot should capture only
the relevant Azure blade or Context7 card (crop out the surrounding Azure
sidebar when it isn't load-bearing for the step).

Suggested viewport: **1440x900**, browser zoom 100%, light theme.

---

## 01-register-app.png

**Where**: Azure Portal → Microsoft Entra ID → Manage → App registrations →
**+ New registration**.

**What to capture**: the New registration form with these fields filled in:

- **Name**: `Context7`
- **Supported account types**: *Accounts in this organizational directory only*
- **Redirect URI**: `Web` + `http://localhost:3000/api/auth/entra/callback`
  (or your real host)

Keep the **Register** button visible at the bottom so readers see the
submit action.

---

## 02-app-overview.png

**Where**: Azure Portal → App registrations → **Context7** → **Overview**.

**What to capture**: the Essentials panel showing **Application (client) ID**
and **Directory (tenant) ID** clearly. Values don't need to be redacted since
they're not secrets, but blur them if you'd rather not expose your real
tenant.

Crop tight to the Essentials block so both IDs are easy to spot.

---

## 03-client-secret.png

**Where**: Azure Portal → App registrations → Context7 → **Certificates &
secrets** → **Client secrets** tab → **+ New client secret**.

**What to capture**: the *Add a client secret* side panel showing the
description field filled in (for example, `Context7 on-prem`) and an
expiry selected. You don't need to show the secret Value itself (and
probably shouldn't).

An alternative, if the create panel feels too modal-heavy: take the shot
after the secret is created, showing the row in the Client secrets table
with the **Value** column highlighted (but redact the actual secret).

---

## 04-app-roles.png

**Where**: Azure Portal → App registrations → Context7 → **App roles**.

**What to capture**: the App roles list with both roles created and
**Enabled** = true:

- `Context7 Admin` / Value: `Context7.Admin`
- `Context7 Member` / Value: `Context7.Member`

Make sure both rows are visible in a single shot so readers see the pair.

---

## 05-assignment-required.png

**Where**: Azure Portal → **Microsoft Entra ID** → Enterprise applications
→ Context7 → **Properties**.

**What to capture**: the Properties page with **Assignment required?** set
to **Yes**. Include the **Save** button at the top so readers know they
need to save.

Note: this is the *Enterprise applications* view, not App registrations.
Worth showing enough sidebar context to make that obvious.

---

## 06-assign-user-role.png

**Where**: Enterprise applications → Context7 → **Users and groups** →
**+ Add user/group**.

**What to capture**: the *Add Assignment* page with:

- **Users**: one user selected (your own name is fine)
- **Select a role**: **Context7 Admin** (or Member, either is fine)

The role picker side panel being visible in the same shot is ideal so
readers see where to click for the role selection.

---

## 07-context7-settings-card.png

**Where**: Context7 dashboard → **Workspace Settings** → scroll to the
**Authentication** section.

**What to capture**: the entire **Microsoft Entra SSO** card with the
sticky **On this page** nav visible on the right. Toggle should be **off**
and status indicator should read *Not configured*.

This is the "empty state" screenshot. All fields blank.

---

## 08-filled-credentials.png

**Where**: same card, after pasting in values.

**What to capture**: the card with:

- **Tenant ID** filled in
- **Client ID** filled in
- **Client Secret**: either shows "Leave blank to keep the current secret"
  with the green "A client secret is already stored" check, or a fresh
  secret paste (redact the actual secret before taking the screenshot)
- **Admin role value**: `Context7.Admin`
- **Member role value**: `Context7.Member`

Toggle can stay off at this point. Status should read *Configured · Toggle
on to show the sign-in button*.

---

## 09-test-success.png

**Where**: same card, after clicking **Test connection**.

**What to capture**: the green success banner *Connection verified with
Microsoft Entra.* right above the Save/Test buttons, with the filled-in
form still visible above it.

---

## 10-login-page.png

**Where**: open `/login` in an incognito window after SSO has been enabled
(toggle on + saved).

**What to capture**: the full login card showing:

- Context7 wordmark at the top
- **Welcome back** heading
- **Continue with Microsoft Entra ID** button with the four-square logo
- *OR WITH PASSWORD* divider
- Username + password form below

Center the card in the frame. Incognito avoids any auto-fill suggestions
cluttering the fields.

---

## 11-users-tab.png

**Where**: Workspace Settings → **Users** tab, after at least one Entra
user has signed in once.

**What to capture**: the Users table showing a mix of providers:

- The seeded `admin` row with `password` under AUTH
- At least one Entra user with `entra` under AUTH, display name, email,
  and a recent **last login** timestamp

A minimum of two rows makes the mixed-provider story land. Redact email
domains if they're sensitive.

---

## Tips

- **File format**: PNG. Avoid JPEG for UI screenshots; text gets fuzzy.
- **Retina**: capture at the native device pixel ratio, then downscale if
  needed. Don't upscale low-DPI shots.
- **Redaction**: use a solid rectangle in a matching background color
  rather than blur when hiding values. Blur often leaks readable pixels
  when rendered small.
- **Consistency**: try to keep the same browser chrome, zoom level, and
  theme across the Azure shots and across the Context7 shots so the
  gallery looks cohesive.
