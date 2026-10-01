# John's requirements (from the NAVAC × John meeting, 2026)

John installs Rosslare access control (AxTraxNG server + AC-825IP-class panels; any reader: card, tag,
fingerprint, face). Hardware and panel integration are solved; the missing piece is business software.

## What he described
- AxTraxNG user has a permanent **user ID / card code** (e.g. 1001); name can change, code never does.
- Validity: user valid from 1 Oct to 31 Oct → AxTraxNG sets 00:01 / 23:59; after expiry the door won't open.
- Today reception takes cash/M-Pesa, then manually extends the date in AxTraxNG. Fraud: member pays 6 months at
  a discount, staff record 1 month, extend 6.
- Wanted: M-Pesa paybill, account = member's code (e.g. 11001) → system extends that user automatically.
  "If you can change the table [date] from the payment, we are 90 % there."
- Rules: 5,000 = 1 month (calendar), 30,000 = 6 months; lapsed member who returns → extend from today.
  Day/walk-in (e.g. 500) → that day. Amount can identify the service (200 swim, 600 sauna); clients must keep
  fixed price lists.
- Numbering convention he uses: 1xxxx walk-ins, 2xxxx monthly, 3xxxx annual (6-digit capacity, 100k users/panel).
- Multi-service clients (mall with gym, spa, sauna, pool, massage, rentals): bundles e.g. 2 days gym incl. pool +
  sauna. Pool walk-ins get wristbands (transponders) not tied to a person.
- AxTraxNG uses departments and access groups ("gym", "gym+sauna", "swim").
- First enrolment manual (biometric/card captured with vendor tool); recurring renewals must be automatic.
- Executive dashboard: wake up, one click → yesterday's money, subscriptions, renewals; compare with bank.
- Panels keep working offline; integration needs the server online.
- Sports clubs: unpaid members demand entry at the gate; nobody in Kenya has integrated access control with
  M-Pesa billing.
- Previous developers got the API and never delivered. He wants to test with own logins (users, not admins)
  and see the date change with a 10-shilling payment.
- Partnership: John markets and sells under his brand; transparent revenue split; NAVAC builds and hosts.
- Future: staff time & attendance / field-force check-in, school child pick-up safety.
