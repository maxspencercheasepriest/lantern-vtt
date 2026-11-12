// ─────────────────────────────────────────────────────────────────────────────
//  LINDQVIST CRYONICS EMPLOYEE PORTAL — content source
//  Everything in STAFF and DIRECTOR is encrypted into the finished page.
//  Edit here and re-run `node build.mjs`, or use the in-page GM panel.
// ─────────────────────────────────────────────────────────────────────────────

export const CREDS = {
  staffUser: 'a.brandt',
  staffPass: 'Kaskelot71',
  directorPass: 'PERSEPHONE-19',
};

// Shown before login — this part is NOT secret.
export const PUBLIC = {
  facility: 'Night City Facility · NC-1',
  company: 'Lindqvist Cryonics AS',
  hq: 'Malmö · Copenhagen · Night City',
  build: 'PORTAL v4.1.2 (build 2023.07.19)',
  notice:
    'Scheduled maintenance window 21 August, 0200–0500. Registry writes will be unavailable.',
  sealDate: '2023-08-20',
};

export const STAFF = {
  user: { name: 'Dr. Anneke Brandt', role: 'Senior Clinician', id: 'LC-0447' },
  greeting: 'Welcome back, Dr. Brandt.',
  sections: [
    {
      id: 'bulletins',
      label: 'Bulletins',
      kind: 'list',
      items: [
        {
          title: 'War contingency — all-staff briefing, Friday 1400',
          meta: 'M. Solberg · Registrar · 2023-08-08',
          body: `<p>Following guidance from Malmö, all clinical staff are required to attend a contingency briefing in the Tier-2 conference suite this Friday.</p>
<p>Topics: evacuation routing, patient transfer priority, and the reserve cell protocol. Attendance is mandatory. Yes, including night shift.</p>
<p>Malmö have asked me to remind everyone that the facility is <em>not</em> a shelter and should not be described as one to family members.</p>`,
        },
        {
          title: 'Coolant delivery delayed at Watson checkpoint',
          meta: 'Y. Adeyemi · Facilities · 2023-08-09',
          body: `<p>Our nitrogen shipment is sitting at the Watson checkpoint behind a Militech convoy and has been for two days. Nobody will tell me for how much longer.</p>
<p>We have eleven days of margin at current occupancy. That is fine. It stops being fine if occupancy changes. If anyone upstairs is planning an intake they have not told me about, now would be a lovely time to mention it.</p>`,
        },
        {
          title: 'Reminder: personal shards are not to be connected to facility terminals',
          meta: 'IT Services · 2023-07-28',
          body: `<p>The suspension network is air-gapped by design and is to remain so. This includes the staff room terminal, which is on the same segment regardless of what you have been told.</p>
<p>Three violations logged this month. The next one goes to the Director.</p>`,
        },
        {
          title: 'Tier-3 suite access requires escort at all times',
          meta: 'T. Okonkwo · Security · 2023-07-14',
          body: `<p>Badge access to Tier-3 has been reduced to Director level and above. Clinical staff requiring access must be escorted by security.</p>
<p>This is not a reflection on anyone. It is a client requirement.</p>`,
        },
      ],
    },
    {
      id: 'registry',
      label: 'Patient Registry',
      kind: 'registry',
      note: 'Registry writes locked pending maintenance window. 12 bays · 1 occupied.',
      columns: ['Bay', 'Registry ID', 'Subject', 'Intake', 'Status'],
      rows: [
        ['01', 'LC-NC-1187', 'HOLM, Greta', '2019-03-04', 'TRANSFERRED — MALMÖ'],
        ['02', 'LC-NC-1203', '███████, ███', '2019-11-22', 'REVIVED 2021-06-02'],
        ['03', 'LC-NC-1241', '███████████', '2020-01-17', 'TERMINATED — POWER EVENT 2022-04-11'],
        ['04', 'LC-NC-1258', '███████, █████', '2020-08-30', 'TRANSFERRED — MALMÖ'],
        ['05', '—', '—', '—', 'VACANT'],
        ['06', 'LC-NC-1302', '████████, ██', '2021-05-19', 'TERMINATED — POWER EVENT 2022-04-11'],
        ['07', '—', '—', '—', 'VACANT'],
        ['08', '—', '—', '—', 'VACANT — DECOMMISSIONED'],
        ['09', '[SEALED]', '[RECORD SEALED]', '2023-08-17', 'SUSPENDED — DIRECTOR ACCESS REQUIRED'],
        ['10', '—', '—', '—', 'VACANT'],
        ['11', '—', '—', '—', 'VACANT'],
        ['12', '—', '—', '—', 'VACANT — DECOMMISSIONED'],
      ],
      sealed: 8, // zero-based row index rendered as the locked entry
    },
    {
      id: 'mail',
      label: 'Mail',
      kind: 'thread',
      note: 'Thread: PRIORITY INTAKE — BAY 09 · flagged CONFIDENTIAL · retention hold',
      items: [
        {
          title: 'Priority intake, Thursday 2200',
          meta: 'P. Vance → A. Brandt · 2023-08-14 09:12',
          body: `<p>Anneke,</p>
<p>Priority intake Thursday, 2200, out of hours. Bay 09. You and Adeyemi only — no registrar, no night security on the floor.</p>
<p>No registry entry will be created. Director authorisation is on file.</p>
<p>— PV</p>`,
        },
        {
          title: 'RE: Priority intake, Thursday 2200',
          meta: 'A. Brandt → P. Vance · 2023-08-15 07:48',
          body: `<p>Piotr,</p>
<p>I have read the intake request twice and I cannot find the indication. The subject is thirty-four, healthy, no terminal diagnosis, no degenerative markers, nothing on the panel at all. She is in better condition than I am.</p>
<p>Suspension without clinical indication is outside our licence in every jurisdiction we hold one. I am not being difficult. I am asking what I am putting my name to.</p>
<p>— AB</p>`,
        },
        {
          title: 'RE: RE: Priority intake, Thursday 2200',
          meta: 'P. Vance → A. Brandt · 2023-08-15 08:03',
          body: `<p>The indication is on file under Director access.</p>
<p>You are not required to agree with it. You are required to perform it.</p>
<p>— PV</p>`,
        },
        {
          title: 'a favour',
          meta: 'A. Brandt → M. Solberg · 2023-08-16 22:30',
          body: `<p>Mira — if anyone asks about bay 09, it is a transfer from Malmö and the paperwork is following. That is what I have been told to say and so that is what we are saying.</p>
<p>She came in awake, Mira. She walked in. Somebody drove her here and she thanked him.</p>
<p>I don't like this either.</p>`,
        },
        {
          title: 'Bay 09 sealed',
          meta: 'Y. Adeyemi → A. Brandt, P. Vance · 2023-08-17 23:41',
          body: `<p>Bay 09 sealed and stable. Core temp nominal, vitrification clean, no crystal formation on the first scan. Textbook.</p>
<p>Reserve cell recabled to prioritise 09 over the rest of the floor, per the client requirement. Nine will outlive this building.</p>
<p>Whoever she is, she's in.</p>`,
        },
        {
          title: '** ALL STAFF ** EVACUATE',
          meta: 'P. Vance → ALL STAFF · 2023-08-20 11:02',
          body: `<p>EVACUATE NOW. GROUND FLOOR, NORTH STAIR, DO NOT USE THE LIFTS.</p>
<p>Do not attempt to bring the bays online. Do not go to Tier-3. Do not go back for —</p>
<p class="corrupt">[ MESSAGE TRUNCATED — SENDER SESSION LOST ]</p>`,
        },
        {
          title: 'AUTOMATED: FACILITY POWER EVENT',
          meta: 'SYSTEM · 2023-08-20 11:58',
          body: `<p class="mono">MAINS POWER LOST.<br>
FACILITY SWITCHED TO RESERVE CELL.<br>
PRIORITY CIRCUIT: BAY 09 (CLIENT REQUIREMENT LC-TIER3-01).<br>
ESTIMATED RESERVE ENDURANCE AT PRIORITY LOAD: 30 DAYS.<br>
NOTIFY FACILITIES IMMEDIATELY.</p>
<p class="corrupt">[ NO ACKNOWLEDGEMENT RECEIVED ]</p>`,
        },
      ],
    },
    {
      id: 'status',
      label: 'Facility Status',
      kind: 'status',
      rows: [
        ['Mains power', 'OFFLINE', 'bad', 'since 2023-08-20 11:58'],
        ['Reserve cell', 'TRICKLE — 0.4%', 'warn', 'priority circuit only'],
        ['Priority circuit', 'BAY 09 — ACTIVE', 'ok', 'core temp nominal'],
        ['Bays occupied', '1 of 12', 'ok', ''],
        ['Sub-level 2', 'FLOODED', 'bad', 'depth sensor 2.1 m'],
        ['Tier-3 suite', 'SEALED', 'warn', 'blast door, manual release only'],
        ['Atmosphere', 'UNBREATHABLE — PARTICULATE', 'bad', 'filtration offline'],
        ['External comms', 'NO ROUTE', 'bad', 'legacy uplink only'],
        ['Last service visit', '—', 'bad', 'DAYS_SINCE'],
      ],
    },
  ],
};

export const DIRECTOR = {
  user: { name: 'Dr. Piotr Vance', role: 'Facility Director', id: 'LC-0001' },
  greeting: 'Director access granted. This session is not logged.',
  sections: [
    {
      id: 'persephone',
      label: 'PROJECT PERSEPHONE',
      kind: 'list',
      items: [
        {
          title: 'Client brief — summary for facility director',
          meta: 'CLASSIFIED · CLIENT COPY · 2023-07-02',
          body: `<p class="mono">CLIENT OF RECORD: ███TECH ███████████ DIVISION<br>
CONTRACT: LC-TIER3-01<br>
SUBJECT: ACHEBE, Delphine Amara · courier grade 4 · age 34<br>
DESIGNATION: PERSEPHONE</p>
<p>The subject has undergone a neural imprinting procedure at the client's own facility. The imprint is not stored data. It is a structural alteration to the subject's hippocampal and associative cortex which produces a deterministic response to a 4,096-bit challenge.</p>
<p>In plain terms: the subject <em>is</em> the key.</p>
<p>The client requires you to understand three properties of this arrangement, because they determine the handling of the subject in your care.</p>
<ul>
<li>The key <strong>cannot be copied.</strong> There is no extract, no backup, no shard.</li>
<li>The key <strong>cannot be read from a corpse.</strong> Verification requires live cortical activity.</li>
<li>The key <strong>cannot be compelled.</strong> Duress alters the response. The subject must be awake, oriented, and willing.</li>
</ul>
<p>Suspension is therefore indicated not for the subject's benefit but for the key's preservation. The client anticipates a period of instability in Night City and wishes the key to be unavailable during it.</p>`,
        },
        {
          title: 'Depository 7 — access conditions',
          meta: 'CLASSIFIED · 2023-07-02',
          body: `<p class="mono">SITE: DEPOSITORY 7<br>
LOCATION: ███████████████████████ [RECORD CORRUPT]<br>
OUTER SEAL: mechanical, non-networked<br>
INNER SEAL: biometric challenge — PERSEPHONE<br>
CONTENTS SCHEDULE: SEE SCHEDULE B [NOT HELD AT THIS FACILITY]</p>
<p>The client will present the subject at the site when conditions permit. Lindqvist's obligation ends at the door of this facility.</p>
<p>Should the client fail to collect within ten (10) years, the contract provides for the subject to be — </p>
<p class="corrupt">[ PARAGRAPH CORRUPT — 411 BYTES UNRECOVERABLE ]</p>`,
        },
        {
          title: 'Subject file — ACHEBE, Delphine Amara',
          meta: 'SEALED RECORD · BAY 09 · intake 2023-08-17 23:41',
          body: `<p class="mono">REGISTRY ID: [WITHHELD — NO PUBLIC ENTRY]<br>
DOB: 1989-02-11 · AGE AT INTAKE: 34<br>
EMPLOYER: ███TECH ███████████ DIVISION · courier grade 4 · 9 yrs service<br>
CLINICAL INDICATION: NONE. SUSPENSION AT CLIENT DIRECTION.<br>
SUBJECT CONSENT: ON FILE — ATTACHMENT UNREADABLE [FILE CORRUPT]<br>
NEXT OF KIN: ACHEBE, N. — daughter, age 9<br>
NOTIFICATION: <span class="bad">SUPPRESSED PER CLIENT INSTRUCTION</span><br>
REVIVAL AUTHORITY: CLIENT ONLY. FACILITY MAY NOT REVIVE.</p>`,
        },
      ],
    },
    {
      id: 'objection',
      label: 'Clinical Objection',
      kind: 'list',
      items: [
        {
          title: 'Formal objection — filed and overruled',
          meta: 'A. Brandt → Board, Malmö · 2023-08-18 04:10 · STATUS: OVERRULED (same day)',
          body: `<p>I performed the suspension on bay 09 last night and I am filing this because I would like there to be a record somewhere that somebody objected.</p>
<p>The subject was healthy. There was no indication. She was told she would be woken in eighteen months and I have now read the contract and there is no mechanism in it by which that would happen.</p>
<p>Her consent attachment will not open. I have asked IT twice. I am told the file is corrupt and that this is not a clinical matter.</p>
<p>She has a daughter. The child has not been told and, as I read the client instruction, will not be. The child is nine.</p>
<p>I am not resigning, because if I resign they will simply hire someone who does not write letters like this one. But I want my name on this page and not only on the chart.</p>
<p>— A. Brandt, Senior Clinician, LC-0447</p>`,
        },
        {
          title: 'Board response',
          meta: 'Board Secretariat, Malmö → A. Brandt · 2023-08-18 16:55',
          body: `<p>Your objection has been received and entered. The contract is lawful in the jurisdiction of execution. No further action is indicated.</p>
<p>You are reminded that the terms of LC-TIER3-01 survive your employment.</p>`,
        },
      ],
    },
    {
      id: 'seal',
      label: 'Seal Order',
      kind: 'list',
      items: [
        {
          title: 'FINAL DIRECTOR ENTRY',
          meta: 'P. Vance · 2023-08-20 11:31 · entered from Tier-3 terminal',
          body: `<p>Tower's gone. I can see it from the Tier-3 window, or I could, there's nothing to see now but the light.</p>
<p>Staff are out. I have sealed Tier-3 behind me on the manual release, which means I am on this side of it, which was not the plan but here we are.</p>
<p>Nine is on the priority circuit and will hold. Thirty days, the system says. Someone from the client will come inside thirty days. They paid too much not to.</p>
<p>If you are reading this and you are not from the client: she did not know. Whatever they told her, she did not know what they had done to her head. That is the part I would like on the record, since Anneke has shown us all how that is done.</p>
<p>Wake her gently. She thinks it is Thursday.</p>
<p class="corrupt">[ SESSION ENDED — TERMINAL POWER LOST 11:58 ]</p>`,
        },
      ],
    },
  ],
};
