// Subset of the AxTraxNG REST API v2.0 schema (docs/research/axtraxng-rest-api.md). Field names are Rosslare's.
export interface ApiResult<T> {
  Data: T;
  Errors: string[] | null;
}
export interface Ref {
  ID: number;
  tDesc?: string;
}
export interface CardInfoDT {
  ID: number;
  iSiteCode: number;
  iCardCode: number;
  eCardType: number;
  CredentialType: number;
  wStatus: 0 | 1 | 2; // 0 free, 1 active, 2 inactive
  IdEmpNum: number; // owning user ID, 0 = free
  iFacilityCodeSecond?: number;
  iIssueNumber?: number;
}
export interface EmployeeInfoDT {
  ID: number;
  EmpNumCompany: number; // user number = Lango member_no
  tFirstName: string;
  tLastName: string;
  tMobile?: string;
  bValidDate: boolean;
  dtStartDate: string | null; // local ISO without offset
  dtStopDate: string | null;
  bAccessDenied?: boolean;
  bEnabled?: boolean;
  UserAccGrp: Ref;
  UserDepartment: Ref;
  UserCards: CardInfoDT[];
  [k: string]: unknown; // the real object has ~60 fields; we always round-trip unknown ones
}
export interface AccessReaderTZInfoDT {
  IdReader: number;
  IdTimeZone: number;
  IdAccessGroup?: number;
}
export interface AccessGroupDT {
  ID: number;
  tDesc: string;
  IsMaster?: boolean;
  IsUnauthorized?: boolean;
  TimezoneReaders: AccessReaderTZInfoDT[];
}
export interface ReaderInfoDT {
  ID: number;
  tDesc: string;
  IdPanel: number;
  IdDoor: number;
}
export interface DoorInfoDT {
  ID: number;
  tDesc: string;
  IdPanel: number;
  bOnline?: boolean;
}
export interface EventPanelInfoDT {
  ID: number;
  IdPanel: number;
  IdReader: number;
  IdDoor: number;
  IdEmpNum: number;
  iCardCode: number;
  iSiteCode: number;
  iEventType: number; // 17-19 granted, 33-35 denied
  dtEventReal: string;
  dtEventUpload: string;
  tFullName?: string;
}
export const UNAUTHORIZED_GROUP_ID = 1000000;
export const TZ_ALWAYS = 2;
export const isGranted = (t: number) => t >= 17 && t <= 25;
