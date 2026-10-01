# AxTraxNG REST API v2.0: technical research

**Source:** Rosslare's official Swagger 2.0 spec (`version: v2.0`, `host: localhost:8080`, `basePath: /api`), exported from Stoplight at `rosslaresecurity.stoplight.io/api/v1/projects/rosslaresecurity/axtraxng-rest-api/nodes/AxTraxNG_REST_API.json?fromExportButton=true&snapshotType=http_service`, plus the project's own articles. Anything not taken from those is marked **[UNVERIFIED]**.

## 1. Deployment and versions
- **Install:** run `AxTraxNGServiceSetup.msi` as administrator on the AxTraxNG server. It runs as a Windows service that talks to AxTraxNG over WCF.
- **Port and host:** the default is `http://<server>:8080`. Change the `host`/`port` keys in `AxTraxNGRestAPIService.exe.config` and restart. Swagger UI is at `/swagger`. If AxTraxNG is unreachable, you get "AXTrax server is not available".
- **HTTPS (v1.9+):** bind a certificate to the port with `netsh http add sslcert`.
- **Versions:** AxTraxNG **27.7.1.20+ requires REST API ≥ 1.8**. **v2.0 makes authorization mandatory on every endpoint** and adds GetFreeCards, GetReaderFormat and two user-group endpoints.
- **Server:** same as AxTraxNG: Windows 10 or Server 2012–2019, SQL Server 2012–2017.

## 2. Authentication
- **Endpoint:** `POST /token`. It is at the service root, **not** under `/api`. Parameters: `grant_type=password`, `Username`, `Password` (OAuth2 password grant). The form-urlencoded body is **[UNVERIFIED]**; Rosslare only shows screenshots.
- **Operator rights:** the operator must be an AxTraxNG operator with **"Modify" rights in Configuration**. The docs say: "Any other operator will not be authenticated".
- **Token use:** it is a **bearer token**. Send `Authorization: Bearer <access_token>` on every call. In Swagger UI, put "bearer {token}" in the `api_key` field.
- **Expiry and refresh:** not documented **[UNVERIFIED]**. The response is probably the standard OWIN `{access_token, token_type, expires_in}`. Read `expires_in`, re-authenticate on 401, and do not count on a refresh token.
- **Spec gap:** the spec has no `securityDefinitions`, so code generators will not add the auth header for you.

## 3. Response envelope
Every response is `ApiResult[T]` = `{ "Data": T, "Errors": [string] }`. The spec declares only HTTP 200 responses, so **check that `Errors` is empty**, not just the status code. Delete calls return `Data: true/false`.

Most entities share these base fields: `ID, tDesc, wStatus, wStatusManual, bEnabled`.

## 4. Endpoint list (42 operations, all under `/api`)
| Resource | Method and path | Notes |
|---|---|---|
| AccessGroup | GET `AccessGroup/GetAccessGroups` | |
| | POST `AccessGroup/Add` | Body: `AccessGroupDT` |
| | PUT `AccessGroup/UpdateAccessGroup` | Send the full group back |
| Card | GET `Card/GetCards?count&offset` | Paged |
| | GET `Card/GetFreeCards?count&offset` | Unassigned cards (`wStatus=0`) |
| | GET `Card/GetCardById?IdRecord` | |
| | GET `Card/GetCardByCode?iCardCode&iSiteCode&eCardType` | |
| | POST `Card/AddCard` | Body: `CardInfoDT` |
| | PUT `Card/UpdateCard` | Body: `CardInfoDT` |
| Department | GET `Department/GetDepartments`, GET `Department/GetDepartment?id` | |
| | POST `Department/Add`, PUT `Department/UpdateDepartment` | Body: `DepartmentInfoDT {ID,tDesc,IsVisitors,…}` |
| Door | GET `Door/GetAll` | Includes `IdPanel`, `bOnline` |
| Events | GET `EventPanelInfo/GetAll?from&to&limit` | All events |
| | GET `EventPanelInfo/GetAccessEvent?from&to&limit` | Access events only (v1.7+) |
| Manual ops | PUT `ManualOperation/PanelManualOperation?panelID`, PUT `ManualOperation/ManualOperation` | Open doors |
| Network | GET `Network/GetNetworks`, GET `Network/GetNetworkById?IdRecord` | |
| Output | GET `Output/GetOutputs`, `GetOutputsByPanelId?Id`, `GetOutputBylId?Id` | |
| Panel | GET `Panel/GetPanels`, `GetPaelsByNetworkId?Id`, `GetByID?Id` | |
| Reader | GET `ReaderInfo/GetAll`, GET `ReaderInfo/GetReaderFormat` | |
| TimeZone | GET `TimeZone/GetAll`, POST `TimeZone/Add`, PUT `TimeZone/Update` | |
| User | GET `User/GetUser?Id&WithPicture` | |
| | GET `User/GetUsers?count&offset` | |
| | GET `User/GetUsersByDepartment?id&count&offset` | |
| | GET `User/GetUserByFilter?FirstName&LastName&UserNumber&CardNumber&AccessGroup&Identification&ByAnd…` | |
| | POST `User/AddUser`, PUT `User/UpdateUser` | Body: `EmployeeInfoDT` |
| | DELETE `User/DeleteUser?Id` | The user's cards become free |
| | DELETE `User/DeleteUserAndCards?Id` | |
| UserGroups | GET `UserGroups/GetUserGroupCarParking`, GET `UserGroups/GetUserCardAndCardGroups` | |

## 5. Key schemas (exact field names)

**`EmployeeInfoDT` (user):**
- Identity: `ID`, `tFirstName`, `tLastName`, `tIdentification`, `EmpNumCompany` (user number), `tMobile`, `tEmail`, `tNotes`, `tCodePIN`
- Relations: `UserDepartment`, `UserAccGrp` (**one** access group per user), `UserCards: [CardInfoDT]`
- Validity and access: **`bValidDate`, `dtStartDate`, `dtStopDate`**, `bAccessDenied`, `bEnabled`
- Plus antipassback, counter, visitor and parking fields.

**`CardInfoDT` (credential):** `ID, iSiteCode` (facility code), `iCardCode` (64-bit), `tSiteCode, tCardCode, iFacilityCodeSecond, iIssueNumber, IdEmpNum` (owner user ID, 0 = free), `eCardType, CredentialType, wStatus, dtSaved, dtLastUsed, IdCardSlot, IdUserSlot, tFullName`
- `CredentialType`: 1 Card (default), 2 BLE, 3 NFC, 4 UHF
- `eCardType` (format): 1 = Wiegand 26 and 4 = W37; the full list runs 1–15 and 101–103. For custom formats, read them from `ReaderInfo/GetAll`.
- `wStatus`: **0 = Available** (only with `IdEmpNum=0`), **1 = Active**, **2 = Inactive** (both only with `IdEmpNum>0`). Set unused `iFacilityCodeSecond` and `iIssueNumber` to `-1`.

**`AccessGroupDT`:**
- Fields: `ID, tDesc, IsMaster, IsUnauthorized, TimezoneReaders: [AccessReaderTZInfoDT {IdAccessGroup, IdReader, IdTimeZone, tDescReader}]`
- Defaults: Master = 1, Unauthorized = 1000000. Time zones: Never = 1, Always = 2.

**`EventPanelInfoDT`:**
- Fields: `ID, IdPanel, IdReader, IdDoor, dtEventReal, dtEventUpload, iEventType, iEventSubType, iEventNum, IdEmpNum, iCardCode, iSiteCode, tFullName, tDesc`
- `iEventType` (`eEventCategory`): 17/18/19 = access granted (code+facility / code / PIN), 25 = AccessRecorded, 33/34/35 = access denied (same variants).
- Other enums: `ePanelStatus` (Inactive, Connected, NotResponding, …) and `eEventDetailsAccessGranted/Denied`.

## 6. Recipes

**Create a user (with a card and an access group in one call):**
- Call `POST /api/User/AddUser`.
- Required: `tFirstName` and `tLastName`.
- `UserDepartment.ID`: 1 = General. Rosslare says "set 0 for default"; 10000 = Visitors.
- `UserAccGrp`: only `ID` is needed.
- `UserCards`: new card objects (Rosslare's example: `iSiteCode:127, iCardCode:55680, eCardType:1, CredentialType:1, wStatus:1, ID:0`) or a free card.
- Set `ID:0` for a new user. The response `Data` returns the created user with its `ID`. Store this ID in your SaaS.

**Update validity dates:**
- Send `PUT /api/User/UpdateUser` with `ID`, `bValidDate:true`, `dtStartDate` and `dtStopDate` (ISO datetime).
- Rosslare's own UpdateUser note asks only for `ID` and lists the other fields as optional. Even so, **GET the user first and PUT the full object back**. Whether omitted fields get reset is **[UNVERIFIED]**.
- Whether `bValidDate` must be `true` for the dates to be enforced is **[UNVERIFIED]**.

**Add or assign a card:**
- To create a card, call `POST /api/Card/AddCard`. With `IdEmpNum=<userId>` and `wStatus=1` it is assigned straight away; with `IdEmpNum=0` and `wStatus=0` it goes into the free pool.
- To assign an existing free card, call `PUT /api/Card/UpdateCard` with `IdEmpNum=<userId>`, `wStatus=1`.
- To suspend a card: `wStatus=2`.
- To unassign a card: `IdEmpNum=0`, `wStatus=0`.
- To look a card up: `GetCardByCode?iCardCode=&iSiteCode=&eCardType=`.
- Limit: 16 cards per user.

**Assign an access group:**
- A user has **one** `UserAccGrp`. Set `UserAccGrp.ID` with `UpdateUser`.
- "Gym + sauna + pool" combinations must therefore be **pre-built as separate access groups** (for example "Gym+Pool"), each with readers and time zones, using `AccessGroup/Add` or the GUI. You cannot stack several groups on one user. This is the main design constraint for your product.

**Enable / disable a user:**
- Option A: set `bAccessDenied` or `bEnabled` with `UpdateUser`. The exact semantics are **[UNVERIFIED]**.
- Option B: set all the user's cards to `wStatus=2`.
- Option C: move the user to the Unauthorized group (ID 1000000).
- **Most reliable:** expire `dtStopDate` and also set the cards to inactive.

**List reference data:**
- `GET AccessGroup/GetAccessGroups`, `Door/GetAll`, `Panel/GetPanels`, `Network/GetNetworks`, `Department/GetDepartments`, `ReaderInfo/GetAll`, `TimeZone/GetAll`
- None of these are paged.

**Events:**
- **Pull:** `GET EventPanelInfo/GetAccessEvent?from=<ISO>&to=<ISO>&limit=` (the default limit is **5000**; the list is truncated at the limit).
- There is **no since-id and no offset paging**. Poll with a sliding time window, dedupe on `ID` (and/or `iEventNum` + `IdPanel`), and shrink the window if you hit the limit.
- Use `dtEventUpload` as well as `dtEventReal` to catch events that offline panels upload late. Whether the `from`/`to` filter applies to `dtEventReal` or to `dtEventUpload` is **[UNVERIFIED]**.
- **Push:** classic ASP.NET SignalR 2 (`Microsoft.AspNet.SignalR.Client`) on the API host. The key hub is `AccessEventsHub`, message `BroadcastAccessEvent`, payload `EventPanelInfo`. There are also Door, Pooling, Input, Output, Network and Panel hubs.
- Whether the hubs need the bearer token is **[UNVERIFIED]**. Node needs a legacy SignalR 2 client, not `@microsoft/signalr`.

## 7. Download to panels
- The API writes to the AxTraxNG server, which "performs an automatic data download for any parameter related to the hardware" (27.7 User Guide), with a download counter in the status bar. So API changes should download automatically **[inferred, not stated for the API]**.
- There is **no download or sync endpoint** in the API. You can only watch `Panel/GetPanels` (`wStatus` / `ePanelStatus`) and `PanelEventHub`.

## 8. Limits and defaults
- **Users / cards per panel:** 100,000 on AC-825/x805 (30,000 on AC-225/425/215IP).
- **Time zones:** 256 on AC-825.
- **Departments:** 1001 in total.
- **Cards per user:** 16.

## 9. Licensing
- **The REST API is free.** The Development Tools brochure V005 says the APIs are offered at no cost to third-party developers. I found no API licence part number.
- **AxTraxNG base software:** the free-of-charge status is widely reported but **[UNVERIFIED]** in an official document. A licence file (activated under Help → Registration) is required for video integrations (for example Hikvision `AX-HIK-L*`) and, per the User Guide, "over a certain amount of readers". The threshold is **[UNVERIFIED]**.
- **AxTraxPro** (the successor) offers an equivalent REST API. Its licence is free below 6 reader ports, with paid Basic and Standard tiers. I did not review its API docs.

## 10. Demo / no-hardware mode
- There is no official "demo mode" **[UNVERIFIED]**.
- Panels can be **added manually** in the tree view by network and address without discovery (User Guide). They then show as not connected. That changes then queue as pending downloads is **[UNVERIFIED]**.
- Users and cards live in SQL, so the API should work without hardware **[UNVERIFIED]**. Access groups reference readers, so add an offline AC-825IP to get them.
- Events will be empty without hardware.

## 11. Gotchas
1. **The API is LAN-only, HTTP by default, on a Windows server.** A cloud SaaS needs an on-site connector or agent that dials out to your cloud, or a VPN or tunnel over HTTPS. Never expose port 8080 to the internet.
2. Several things are covered above: only one access group per user (section 6); the event API has no cursor and a 5000 cap (section 6); you must check `Errors` even on HTTP 200 (section 3); `/token` sits outside `/api` (section 2).
3. The real paths contain Rosslare's typos (`GetPaelsByNetworkId`, `GetOutputBylId`). The spec has no security scheme.
4. Date and timezone handling (local time versus UTC) is **[UNVERIFIED]**. Test the round-trip.
5. Rosslare's docs have inconsistencies. For example, UpdateUser points to Departments for the access-group ID. Validate everything against the live `/swagger`.

**Not found anywhere:** token TTL, rate limits, idempotency guidance, or open-source clients.
