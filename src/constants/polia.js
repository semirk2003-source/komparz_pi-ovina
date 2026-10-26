// Jediné miesto s názvami tabuliek, stĺpcov a povolených hodnôt.
// V aplikácii nepíšeme názvy polí ako reťazce, ale používame tieto konštanty.

export const TABLES = Object.freeze({
  APP_USERS: 'app_users',
  PEOPLE: 'people',
  PERSON_PHOTOS: 'person_photos',
  REGISTRATIONS: 'registrations',
  PERSON_REGISTRATIONS: 'person_registrations',
  PRODUCTIONS: 'productions',
  PRODUCTION_SERIES: 'production_series',
  APPEARANCES: 'appearances',
  ROLE_ALIASES: 'role_aliases',
  SELECTIONS: 'selections',
  SELECTION_ITEMS: 'selection_items',
  FAVORITES: 'favorites',
  SHARE_LINKS: 'share_links',
  AUDIT_LOG: 'audit_log',
})

export const VIEWS = Object.freeze({
  PEOPLE_LIST: 'people_list',
  PEOPLE_DETAIL: 'people_detail',
  APPEARANCES_EFFECTIVE: 'appearances_effective',
  // registrácie bez doplnkových odpovedí (extra) — pre rolu viewer
  PERSON_REGISTRATIONS_PUBLIC: 'person_registrations_public',
})

export const BUCKETS = Object.freeze({
  PERSON_PHOTOS: 'person-photos',
})

export const PEOPLE = Object.freeze({
  ID: 'id',
  LEGACY_ID: 'legacy_id',
  FIRST_NAME: 'first_name',
  LAST_NAME: 'last_name',
  GENDER: 'gender',
  BIRTH_DATE: 'birth_date',
  BIRTH_DATE_APPROX: 'birth_date_approx',
  AGE: 'age', // len v pohľadoch
  PHONE: 'phone',
  EMAIL: 'email',
  ADDRESS: 'address',
  CITY: 'city',
  REGION: 'region',
  HEIGHT_CM: 'height_cm',
  CLOTHING_SIZE: 'clothing_size',
  SHOE_SIZE: 'shoe_size',
  HAIR_COLOR: 'hair_color',
  EYE_COLOR: 'eye_color',
  HAS_TATTOOS: 'has_tattoos',
  TATTOO_NOTE: 'tattoo_note',
  LANGUAGES: 'languages',
  DRIVING_LICENCE: 'driving_licence',
  SKILLS: 'skills',
  PERIOD_LOOK: 'period_look',
  SPEAKING_ROLE: 'speaking_role',
  NOTES: 'notes',
  IS_ACTIVE: 'is_active',
  ANONYMIZED_AT: 'anonymized_at',
  CONSENT_AT: 'consent_at',
  LAST_CONTACTED_AT: 'last_contacted_at',
  CREATED_AT: 'created_at',
  UPDATED_AT: 'updated_at',
  // len v people_list
  THUMB_PATH: 'thumb_path',
  PHOTO_PATH: 'photo_path', // hlavná fotka 1600 px (exporty)
  PHOTO_TAKEN_ON: 'photo_taken_on',
  PHOTO_COUNT: 'photo_count',
  REGISTRATION_IDS: 'registration_ids',
})

// Polia, ktoré smie vidieť len casting a správca.
export const CONTACT_FIELDS = Object.freeze([PEOPLE.PHONE, PEOPLE.EMAIL, PEOPLE.ADDRESS])

export const PHOTOS = Object.freeze({
  ID: 'id',
  PERSON_ID: 'person_id',
  STORAGE_PATH: 'storage_path',
  THUMB_PATH: 'thumb_path',
  IS_PRIMARY: 'is_primary',
  SORT_ORDER: 'sort_order',
  TAKEN_ON: 'taken_on',
  WIDTH: 'width',
  HEIGHT: 'height',
  CREATED_AT: 'created_at',
})

export const PHOTO_LIMITS = Object.freeze({
  MAX_PER_PERSON: 5,
  FULL_LONG_EDGE: 1600,
  THUMB_LONG_EDGE: 400,
  SIGNED_URL_SECONDS: 60 * 60,
})

export const REGISTRATIONS = Object.freeze({
  ID: 'id',
  NAME: 'name',
  PERIOD_START: 'period_start',
  PERIOD_END: 'period_end',
  NOTE: 'note',
})

export const PERSON_REGISTRATIONS = Object.freeze({
  PERSON_ID: 'person_id',
  REGISTRATION_ID: 'registration_id',
  RESPONDED_AT: 'responded_at',
  EXTRA: 'extra',
})

export const PRODUCTIONS = Object.freeze({ ID: 'id', NAME: 'name', KIND: 'kind' })
export const PRODUCTION_SERIES = Object.freeze({ ID: 'id', PRODUCTION_ID: 'production_id', NAME: 'name' })

export const APPEARANCES = Object.freeze({
  ID: 'id',
  RAW_NAME: 'raw_name',
  NAME_OVERRIDE: 'name_override',
  SHOOT_DATE: 'shoot_date',
  ROLE_NAME: 'role_name',
  PRODUCTION_NAME: 'production_name',
  SERIES_NAME: 'series_name',
  ORIGINAL_SHOOT_DATE: 'original_shoot_date',
  ORIGINAL_ROLE_NAME: 'original_role_name',
  ORIGINAL_PRODUCTION_NAME: 'original_production_name',
  ORIGINAL_SERIES_NAME: 'original_series_name',
  PERSON_ID: 'person_id',
  MATCH_STATUS: 'match_status',
  MATCH_SCORE: 'match_score',
  IS_EXCLUDED: 'is_excluded',
  SOURCE: 'source',
  // len v appearances_effective
  DISPLAY_NAME: 'display_name',
  ROLE_EFFECTIVE: 'role_effective',
  PRODUCTION_EFFECTIVE: 'production_effective',
  SERIES_EFFECTIVE: 'series_effective',
  EXCLUDED_EFFECTIVE: 'excluded_effective',
})

export const MATCH_STATUS = Object.freeze({
  UNMATCHED: 'unmatched',
  SUGGESTED: 'suggested',
  CONFIRMED: 'confirmed',
})

export const MATCH_STATUS_LABELS = Object.freeze({
  [MATCH_STATUS.UNMATCHED]: 'Nepriradený',
  [MATCH_STATUS.SUGGESTED]: 'Navrhnutý',
  [MATCH_STATUS.CONFIRMED]: 'Potvrdený',
})

export const ROLE_ALIASES = Object.freeze({
  ID: 'id',
  KIND: 'kind',
  RAW_VALUE: 'raw_value',
  CANONICAL_VALUE: 'canonical_value',
  IS_EXCLUDED: 'is_excluded',
})

export const ALIAS_KIND = Object.freeze({
  ROLE: 'role',
  PRODUCTION: 'production',
  SERIES: 'series',
})

export const ALIAS_KIND_LABELS = Object.freeze({
  [ALIAS_KIND.ROLE]: 'Postavy',
  [ALIAS_KIND.PRODUCTION]: 'Projekty',
  [ALIAS_KIND.SERIES]: 'Série',
})

export const SELECTIONS = Object.freeze({
  ID: 'id',
  NAME: 'name',
  PROJECT_NAME: 'project_name',
  SUBTITLE: 'subtitle',
  IS_ARCHIVED: 'is_archived',
  CREATED_AT: 'created_at',
  UPDATED_AT: 'updated_at',
  CREATED_BY: 'created_by',
  UPDATED_BY: 'updated_by',
})

export const SELECTION_ITEMS = Object.freeze({
  SELECTION_ID: 'selection_id',
  PERSON_ID: 'person_id',
  NOTE: 'note',
  SORT_ORDER: 'sort_order',
  ADDED_AT: 'added_at',
  ADDED_BY: 'added_by',
})

export const FAVORITES = Object.freeze({ USER_ID: 'user_id', PERSON_ID: 'person_id' })

export const APP_USERS = Object.freeze({
  ID: 'id',
  EMAIL: 'email',
  FULL_NAME: 'full_name',
  ROLE: 'role',
  IS_ACTIVE: 'is_active',
})

export const AUDIT_LOG = Object.freeze({
  ID: 'id',
  TABLE_NAME: 'table_name',
  ROW_ID: 'row_id',
  ACTION: 'action',
  OLD_DATA: 'old_data',
  NEW_DATA: 'new_data',
  CHANGED_BY: 'changed_by',
  CHANGED_AT: 'changed_at',
})

// ---------------------------------------------------------------------
// Povolené hodnoty
// ---------------------------------------------------------------------

export const ROLES = Object.freeze({ ADMIN: 'admin', CASTER: 'caster', VIEWER: 'viewer' })

export const ROLE_LABELS = Object.freeze({
  [ROLES.ADMIN]: 'Správca',
  [ROLES.CASTER]: 'Castingový pracovník',
  [ROLES.VIEWER]: 'Prizeraný',
})

export const GENDERS = Object.freeze(['Žena', 'Muž', 'Iné'])

export const REGIONS = Object.freeze([
  'Západné Slovensko',
  'Stredné Slovensko',
  'Východné Slovensko',
  'Česko',
  'Iné / neuvedené',
])

export const CLOTHING_SIZES = Object.freeze(['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'Iné/detské'])

export const AGE_DECADES = Object.freeze([
  { key: '0-9', label: '0–9', min: 0, max: 9 },
  { key: '10-19', label: '10–19', min: 10, max: 19 },
  { key: '20-29', label: '20–29', min: 20, max: 29 },
  { key: '30-39', label: '30–39', min: 30, max: 39 },
  { key: '40-49', label: '40–49', min: 40, max: 49 },
  { key: '50-59', label: '50–59', min: 50, max: 59 },
  { key: '60-69', label: '60–69', min: 60, max: 69 },
  { key: '70+', label: '70+', min: 70, max: 200 },
])

export const PRODUCTION_KINDS = Object.freeze(['film', 'seriál', 'reklama', 'iné'])

export const BRATISLAVA = 'Bratislava'

// Profil je „nový v databáze", ak bol vytvorený za posledných N dní.
export const NEW_PROFILE_DAYS = 60

// Pri väčšom počte profilov upozorniť pred exportom PDF/PPTX.
export const EXPORT_LARGE_THRESHOLD = 80
