# Research digest: AccessControl/Meeting Prep + ROSSLARE API PDFs

Source folder: `$HOME/mnt/AccessControl` (read-only pass, nothing modified). Also present but outside this brief: `Meeting Transcript.txt` (55 KB, not read), `Setup AxTraxNG REST API Service 2.0.0.0 31102024.exe`, `AxTraxNG REST API Notes.docx`, `AxtraxNG v27_7_1_20 Notes & Docs.docx`, `AxtraxNG_HIDPI_display.pdf` (those last three were skimmed; see B.10).

---

## A) Meeting Prep digest (prepared 27 Sep 2026)

**Framing.** The partner (installer of turnstiles, biometric/RFID readers and controllers) has this problem: a gym member stops paying, but the door still lets them in. Earlier developers failed, most likely because there was no ongoing owner, no test environment, no vendor docs, and a one-off flat fee. The positioning line: *"We connect the door to the business rule that controls it, and the door keeps working when the internet doesn't."*

**Key strategic decision (doc 15, supersedes 01–14 where they conflict):**
- **Option 1 (recommended): NAVAC builds and owns the vertical business system.** That covers registration, billing/subscriptions, dashboard and biometric/card enrolment at sign-up, and it pushes credentials and status straight to the access hardware. There is one system of record, nothing to reconcile, a single enrolment, one consent/DPIA surface, and the subscription revenue is stickier. Gyms fit best because most run on spreadsheets or manual processes. It can be built as a new module or tenant type on NAVAC CRM/BMS.
- **Option 2 (fallback): integration layer only.** Middleware between a client's existing ERP and its access-control system. Use this only where the client won't give up an entrenched system (offices with HR/payroll, estates with property software).
- This makes Option 1 the direct basis for John's premium multi-tenant membership/billing SaaS. The AxTraxNG server becomes the "access-control side" adapter.

**Architecture principles (still fully relevant):**
- The door decision is always made **locally at the controller** from its cached list. The cloud only pushes updates ahead of time and never sits in the per-swipe path.
- Manage the "stale window": sync frequently, set **expiry dates on the credential itself** (this maps to AxTrax *Valid Until*), and alert when a site has been offline too long.
- A **local gateway/edge service** is the standard pattern for local-protocol hardware. It queues events while offline.
- Build a **vendor-neutral abstraction** (`grant`, `revoke`, `onAccessEvent`) with one adapter per vendor.
- Webhooks, if available, must be paired with polling. Events need de-duplication by unique event ID.
- Avoid direct writes to the vendor database. CSV/batch sync is a last resort only.
- Fail-safe vs fail-secure is a lock/fire-code decision, not something the software controls.
- The 15-step vendor-onboarding framework maps to billing phases: steps 1–5 are discovery, 6–9 the PoC (including physically verifying that revocation works and testing a network pull), 10–12 development, 13–14 pilot and monitoring, 15 rollout.

**Commercial model (doc 09; illustrative, not quotes):**
- Discovery fee of about KES 30–60k.
- Development fee of about KES 150–350k.
- Monthly platform fee of about KES 5–15k per site, or KES 2–5k per door, starting at go-live.
- Lower per-site deployment fee for later sites.
- Under Option 1, price as a SaaS subscription (per site or by active-member tier, GymGrid-style) and keep a discovery fee for the hardware piece.
- Preferred partner structure is **Model D**: NAVAC bills the partner wholesale and the partner marks up to his own clients. White-label (Model E) comes later.
- Never discount the recurring fee. If a concession is needed, discount discovery.
- Hardware failure is the installer's or vendor's responsibility, and this must be written down.

**Pilot plan (doc 11):**
- One gym, one site, one hardware model, one rule (active → allow, lapsed → deny).
- Grace periods, freezes and tiers are deferred.
- Paid discovery, then a paid PoC, then a paid pilot, with the support fee starting from go-live.
- Success means: a status change reaches the door within an agreed window, the site survives a real outage, and NAVAC detects failures before the client does.

**Kenya market facts (doc 05):**
- ZKTeco and Hikvision dominate through many price-competing resellers. Almost none sell an integration product.
- **GymGrid** charges KES 15k–120k per year by member count and has a "Door Agent". **Elimikasasa** charges KES 2,500/month and runs on ZKTeco F18. Both prove demand and both are closed vertical products.
- Property SaaS has **no gate integration**, which makes it the 3rd vertical after gyms and offices. Examples: Bomahut at KES 2,500–7,000/month, Nyumba Zetu at KES 60–350/unit/month, Eazzyrent at KES 3–7k.
- Hardware prices: readers KES 9.5k–58k, 1–4 door controllers KES 39k–55k, full-height turnstile about KES 850k.
- **DPA 2019:** biometrics are sensitive personal data. Organisations must register with the ODPC (from KES 4,000 for small entities), a DPIA is expected, and consent is required. Store **templates only** and minimise data.

**Vendor notes (doc 04):**
- ZKTeco uses Pull/Push SDKs on port 4370, is Windows-centric and had critical CVEs in 2024.
- Hikvision has ISAPI and OpenAPI but needs partner enrolment. Hikvision and Dahua are on the US FCC list.
- Suprema BioStar 2 has a Local API. Its 2019 leak of 28 million biometric records is the cautionary example.
- Genea on Mercury panels is the reference architecture: local panel decisions with a cloud management API.
- **Rosslare is not covered in the prep docs.** AxTraxNG is new information (see B).

**Open questions (doc 14):**
- Exact hardware and firmware at the sites.
- What software clients currently use.
- Why previous attempts failed.
- How grace periods, freezes and tiers should work, and how to tell a failed M-Pesa payment from an unpaid one.
- Who carries hardware-fault liability.
- ODPC registration and consent.
- Exclusivity.
- Whether NAVAC would resell hardware.
- NAVAC's own engineering capacity alongside CRM/BMS.

**Roadmap (doc 10):** pilot → extract reusable interface → 2nd vendor → multi-tenancy at 2–3 paying sites → productise a vertical → partner ecosystem. The warning is not to over-build ahead of demand. *Note: for John's premium SaaS, multi-tenancy is a day-one requirement, which goes beyond this phasing.*

---

## B) AxTraxNG technical digest (v27.7.x; Release Notes v27.7.1.20, Sep 2023)

**1. What it is.** AxTraxNG is a Windows client-server head-end for Rosslare panels: AC-215/215IP, AC-225/225IP, AC-425/425IP (A and B variants) and AC-825IP with R/S/D/P-805 expansions. It also supports Bio 8000/9000 fingerprint and face terminals and the DR-B8000/DR-B9000/DR-U955BT USB enrolment readers.
- **Components:**
  - *AxTraxNG Server*: a Windows service, the only thing that touches SQL, and the bridge between SQL, panels and clients.
  - *AxTraxNG Client*: the UI. Unlimited clients are allowed, and WAN clients are supported via WCF from v25.
  - *Server Monitor*: tray app, formerly Watchdog.
  - *AxTraxNG Configuration Tool*.
  - Also bundled: AxTime, ViTrax and ViTrax LPR. These are **no longer supported, so don't select them**.

**2. OS / SQL requirements**

| Source | Windows | SQL Server | Hardware |
|---|---|---|---|
| Release notes v27.7.1.20 | Win 8, 10, 11 64-bit; Server 2016/2019 | MS-SQL 2014/2016/2017/2019 | i5, 4 GB RAM, 500 GB disk |
| Install guide | Win 7 SP1, 8.1, 10 (32/64-bit) | Installer bundles **SQL Server Express 2019** (some slides still say 2012) | 4 GB RAM min (8 recommended), 5 GB disk |

- .NET 4.5 or later is required.
- The guide calls for a dedicated PC with no other SQL instance, online 24/7.
- SQL instance name is **VERITRAX** (service `MSSQL$VERITRAX`).
- The manual SQL 2012 install (Install_SQL_2012.pdf) uses:
  - SQLEXPR_x86_ENU.exe → New stand-alone installation → Database Engine Services only.
  - Instance name `Veritrax`.
  - Service account `NT Authority\system`.
  - **Mixed Mode** with a fixed SA password printed on p.8 of that PDF. Type it by hand; Rosslare says copy-paste fails.
  - Use the manual route only when the bundled installer's SQL step fails.

**3. Install order (Installing_AxtraxNG_27_7_1_2X + User Guide ch.3–4)**
1. Restart Windows and finish any pending "Update and restart". The Move guide says pending updates make the install fail.
2. Extract the ZIP. Right-click `AxtraxNGSetup…exe` → **Run as administrator**.
3. Tick **I Agree** → select **Server with Server Monitor and Client** → **Start**.
4. Client wizard: Next / I accept / Finish. The **Configuration Tool** wizard runs next.
5. SQL screen. Choose one:
   - **Install as Default**: new install with no SQL present.
   - **Custom**: keep an existing SQL instance and create a new dedicated one. Needs the SQL Server Browser service running; then click Refresh.
   - **Skip**: upgrade from v24+ on SQL 2012 or later.

   Wait until "Done" appears.
6. Server wizard → Server Monitor wizard. Accept all defaults and don't change paths. No reboot needed.
7. Post-install:
   - Right-click `firewall.cmd` in the extracted folder → Run as administrator.
   - Manual fallback: Windows Defender Firewall → Advanced Settings → Inbound Rules → New Rule → Program → `C:\Program Files (x86)\Rosslare\AxtraxNG Server\AxtraxService.exe` → Allow → name `axtraxng`.
8. Check that the tray shows "server connected".
9. Log in. Default operator is **Administrator**, password **admin**; change it.
10. Licence: Help → Registration (see B.5).

**Upgrades:**
- First run Tools → Database → **Backup now**.
- Stop the *Server Monitor* process and *AxtraxServerService* in Task Manager, or they won't upgrade.
- Run the installer, then update firmware on every panel.

**4. Services and ports**
- **Services:**
  - `AxtraxNG Server` and `MSSQL$VERITRAX` (SQL Server (VERITRAX)) must both be Running, startup type Automatic, logon as Local System.
  - The "Server Connection Failure" error in the client is usually a service that stopped after a Windows Update. Fix: Task Manager → Services, or services.msc → Start.
- **Network:**
  - Server PC and panels need **static IPs** and must sit on the **same LAN/subnet for initial panel setup**. Panel configuration uses ARP broadcast and UDP, so don't block either.
  - WAN/VPN management is fine after initial setup.
- **Ports:**
  - Panel TCP port: the user chooses it. Recommended value is 4001 or higher and not ending in 0 (e.g. 4243).
  - Client↔server port: set in AxTrax Config Tool → Server tab ("Server Connection" port). The docs give no default value.
  - **REST API service: port 8080**, with Swagger at `http://localhost:8080/swagger`.
  - Gmail SMTP: `smtp.googlemail.com` (not gmail.com), port 587, SSL on, using a Google app password. Set it in Server Monitor → Options.
- Only Windows Defender is a supported firewall/antivirus. Third-party AV must be disabled if problems occur.

**5. Licensing (Server Licensing tech note, 2016)**
- From v27.5, licensing counts **readers**:
  - **Level 0 covers up to 256 readers and is free with no activation.**
  - L1: 1024 readers. L2: 2048. L3: more than 2048.
- Reader counts per panel:
  - AC-215/225: 2 readers.
  - AC-225 + MD-D02: 4. AC-425: 4. AC-425 + MD-D04: 8.
  - AC-825IP: 6. AC-825IP + D805: 10. D805 on RS-485: 4.
- Paid levels use a **hardware-locked licence file**: send the Hardware ID (from Help → Registration) plus a PO to Rosslare. Two major hardware changes invalidate the licence.
- Pre-v27 used a HASP USB dongle.
- Release notes: the licence supports **32 biometric terminals** and can be extended.
- **No trial or demo mode is mentioned anywhere.** Free Level 0 is effectively the dev and small-site tier.
- Separate paid add-ons exist for Hikvision/Dahua NVR integration (AX-HIK-L1…L5, AX-DAH-L1…L5).

**6. Running without panels (inference, not stated by Rosslare)**
- Networks and panels can be **added manually**: AC Networks → Add, then Panel Add with a typed address 1–32 and hardware type, without using Find Panels.
- Networks have an **Enabled** tick ("if not selected, communication to panels is halted"). Panels have Enabled ("clear if the panel is not connected").
- Users, departments, access groups, time zones and cards are all database objects, so a pure-software sandbox looks feasible.
- Parameter changes queue as "downloads" (a count on the status bar and a Downloads column), which suggests they are pushed when a panel connects.
- There is no simulator or demo panel. Verify this hands-on.
- An AC-825IP network needs hardware type and MAC at creation, and these are immutable afterwards.

**7. Data model (Tree View: Users / Groups / Timing)**
- **Department**: every user belongs to one.
- **User:**
  - First/Middle/Last name.
  - **User Number** (unique).
  - Department and **Access Group** (default "Unauthorized").
  - **Valid Date From / Until**. On the AC-215 only the date counts and *Until* is exclusive.
  - **Counter** (Enable / Set new counter / Value) for entry-count limits.
  - Antipassback Immunity (Never/Always/time zone), Extended Door Open, Interlock Immunity, Car Parking group, Card+Card group, links/output groups.
  - Details tab: phone, mobile, email, address, employment date, notes.
  - User Fields tab: custom fields defined in Tools → Options → User Custom Fields.
  - Photo.
  - Visitor variant: visit date, host, and auto-disable on exit.
- **Credentials:**
  - Up to **16 per user**.
  - Card number plus **Facility Code** (0–255). A reader can accept up to 4 facility codes, or be set to "Check Facility Code Only".
  - Format is the reader's Wiegand type: 26-bit default, plus 30/32/35/36 and custom formats via AC Networks → Reader Type (Appendix O). The Rosslare 38-bit format adds Issue Number and Site Code.
  - PIN and Duress PIN of 4–8 digits.
  - Fingerprint enrolment (Bio terminal or DR-B desktop scanner), face enrolment from a terminal, and licence-plate credentials.
  - Cards must exist (Users → Cards, or batch Add Users and Cards up to 1000) **before** you associate them: Credentials → *Add from List*.
  - Card Automation can auto-delete or notify on unused cards.
- **Time Zones**: weekly intervals, up to 16 per day (8 on AC-215A). Maximum 128, or 256 on AC-825IP. Holidays: up to 64.
- **Access Group** = set of readers × time zone. Each user has one.
- **Access Areas**: enter/exit readers. Required for **Global Antipassback**, which is enforced only while the server is connected and only on Enter readers. Also required for car-park counters.
- **Panel/reader antipassback**: Hard (deny) or Soft (allow and log), timed in minutes.
- **User counters**: reader → General tab → *Deduct User Counter*. Panel → Options → reset the counter on re-enable.
- **Capacity**: 30,000 credentials per panel (5,000 on AC-215; 100,000 on AC-825IP); up to 1023 panels.

**8. Download and events**
- Configuration changes are automatically downloaded to panels, so panels decide locally.
- After upgrading or moving, use **Update Firmware** per panel. If you see "incompatible firmware", choose Yes; then OK with no changes; then watch the network's Downloads column fall to 0.
- Events filter: Always Active or "Active when panel disconnected".
- Full Upload of panel events can take up to 3 hours and should only be done with Tech Support.
- **Event views:** Online, Panels, Access, Alarm, System, Biometrics; last hour/day/week. Antipassback Forgive.
- **Reports:**
  - Immediate: Who's been in today, Last known position, Roll-call readers/areas, Area occupancy.
  - Panel: Attendance, AC Panels, Access, Readers, Bio Terminals, Visitors.
  - System: System, Operators, Alarm/APB.
  - Interactive: User Access Rights, Not Responding Users, Panel Links.
  - Reports can be scheduled with email delivery.
- **Integration hooks other than REST:**
  - Tools → Import/Export Data: Excel columns A–T.
  - Tools → Options → Custom Operations: periodic comma-separated TXT user import, plus a **Shared Database** export (TimeKeep / External DB).
  - Tools → Database: Export Access Events.
  - Email notifications.

**9. Database operations**
- Tools → Database offers: Periodic Backup, Backup now, Import/Export Configurations and Events, Limit Panel Events Period (91 days or less recommended), and Import earlier version.
- Backups must go to a **local** drive, not a network share or cloud folder. Files carry the suffix `_AxTrax1_vX`. Imports are read from `C:\ProgramData\Rosslare Enterprises Ltd`.
- Moving to a new PC:
  1. Back up to USB and wait 2 minutes.
  2. Stop and disable the old server service.
  3. Install on the new PC, then Import ("Configurations and Events", or "earlier version").
  4. Update firmware on all panels.
  5. Re-enable any panels that show as disabled.
- Server Monitor → Restart Server or DB Connection (admin password needed). It also has **"Clear Database"**, which resets to factory state. Avoid it.

**10. Other files**
- **REST API v2.0** (from the notes docx):
  - Install `Setup AxTraxNG REST API Service 2.0.0.0` on the AxTraxNG server PC.
  - Requires AxTraxNG 27.7.1.20 or later.
  - Open port 8080. Authentication and authorisation are required.
  - Docs: rosslaresecurity.stoplight.io/docs/axtraxng-rest-api.
- **HiDPI fix**: client shortcut → Properties → Compatibility → Change high DPI settings → Override → System.
- **AxTraxPro**: a sibling Rosslare product. Its email is set under Tools → Notification Settings. The NDAA note (Jul 2024) says AxTraxPro video integration with Hikvision/Dahua cameras is non-compliant for US federal use. Nothing else on how AxTraxPro relates to NG.

**11. Gotchas**
- Run the installer as admin, with no pending Windows updates.
- Use a static IP and the same subnet for the first panel setup.
- Third-party antivirus or firewalls break communication.
- Install SQL Express under the same Windows account that runs AxTraxNG.
- On multi-NIC PCs the server binds the highest-priority adapter. Set the interface metric, or use Server Monitor → Use Static IP (default 127.0.0.1).
- Windows Update stops the services.
- A v27.0 licence file doesn't work on v27.5+.
- Known issues in v27.7.1.20:
  - The server can override panel decisions regardless of Wiegand format.
  - Credentials aren't imported for users in the *Unauthorized* access group, so set the group before importing.
  - AC-825IP is limited to 255 output groups.
  - Mixing Bio8000 and Bio9000 needs the same 10-finger enrolment.
- Removing an expansion board means deleting the panel.
- Bootloaders must match firmware.
