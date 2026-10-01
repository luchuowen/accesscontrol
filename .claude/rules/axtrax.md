---
paths:
  - "packages/axtrax/**"
  - "apps/bridge/**"
---
# AxTraxNG REST API v2.0 reference (full notes: docs/research/axtraxng-rest-api.md)
- Base `http://localhost:8080`; `POST /token` (grant_type=password, Username, Password) outside `/api`; Bearer after.
- Envelope `{Data, Errors[]}`; HTTP 200 even on error → check Errors.
- User `EmployeeInfoDT`: ID, EmpNumCompany, tFirstName, tLastName, bValidDate, dtStartDate, dtStopDate, bAccessDenied,
  UserAccGrp{ID}, UserDepartment{ID}, UserCards[CardInfoDT], tMobile. Add `POST /api/User/AddUser`,
  update `PUT /api/User/UpdateUser` (GET first, merge, PUT whole), find `GET /api/User/GetUserByFilter?UserNumber=`.
- Card `CardInfoDT`: ID, iSiteCode, iCardCode(int64), eCardType(1=W26), CredentialType(1 card), wStatus 0 free/1 active/
  2 inactive, IdEmpNum; unused iFacilityCodeSecond/iIssueNumber = -1. `POST Card/AddCard`, `PUT Card/UpdateCard`.
- Access group `AccessGroupDT`: ID, tDesc, TimezoneReaders[{IdReader, IdTimeZone}]; TZ 1 Never, 2 Always;
  Unauthorized group ID 1000000. One group per user. `GET AccessGroup/GetAccessGroups` (includes TimezoneReaders),
  `POST AccessGroup/Add`, `PUT AccessGroup/UpdateAccessGroup` (full object; verified in lab).
- UpdateUser with missing validity dates is accepted but not applied: always send a real window; re-read to confirm.
- Events `GET EventPanelInfo/GetAccessEvent?from&to&limit` (≤5000, no cursor): ID, dtEventReal, dtEventUpload,
  IdReader, IdDoor, IdEmpNum, iCardCode, iSiteCode, iEventType (17-19 granted, 33-35 denied).
- Reference: Door/GetAll, ReaderInfo/GetAll, Panel/GetPanels, Department/GetDepartments, TimeZone/GetAll.
- Typos are real: `Panel/GetPaelsByNetworkId`, `Output/GetOutputBylId`.
