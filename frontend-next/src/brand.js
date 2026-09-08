// The one place the school's identity is spelled out. The sidebar, the mobile
// topbar and the user chip all render it, so it lives here rather than as a
// literal in three files.
export const SCHOOL_NAME = 'The Creative School'

// The letter in the round avatar. Deliberately the school's initial and not the
// signed-in username's: this is a single-tenant tool for one school, and the
// login account is a shared office account whose name says nothing useful.
export const SCHOOL_INITIAL = SCHOOL_NAME[0].toUpperCase()
