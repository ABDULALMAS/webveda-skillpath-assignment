import * as React from "react"
import { addPropertyControls, ControlType } from "framer"

type Course = {
    courseName: string
    courseCode: string
    description: string
    mainCategory: string
    shortCourse: string
    courseType: string
    pricePaise: number
    priceUsdCents: number
    refundable: boolean
}

type Country = "IN" | "US" | null
type SortOption = "default" | "price-low" | "price-high"

const COURSE_URL = "https://syncsphere-hiv6.onrender.com/assignment/course-data"
const COUNTRY_URL =
    "https://syncsphere-hiv6.onrender.com/assignment/country-code"

// Render's free tier cold-starts slowly; bail out and show an error
// rather than leaving the skeleton spinning indefinitely.
const REQUEST_TIMEOUT = 10_000

const ACCENTS = [
    { background: "#FF3155", foreground: "#FFFFFF" },
    { background: "#19A9E8", foreground: "#0B0D12" },
    { background: "#E8F000", foreground: "#0B0D12" },
    { background: "#8EDCF5", foreground: "#0B0D12" },
]

// Validate the response shape before using course data.
function isValidCourse(course: unknown): course is Course {
    const c = course as Course
    return (
        !!c &&
        typeof c === "object" &&
        typeof c.courseName === "string" &&
        typeof c.courseCode === "string" &&
        typeof c.description === "string" &&
        typeof c.mainCategory === "string" &&
        typeof c.shortCourse === "string" &&
        typeof c.courseType === "string" &&
        Number.isFinite(c.pricePaise) &&
        c.pricePaise >= 0 &&
        Number.isFinite(c.priceUsdCents) &&
        c.priceUsdCents >= 0 &&
        typeof c.refundable === "boolean"
    )
}

/* ---------- small reusable pieces ---------- */

function FilterSelect({
    label,
    ariaLabel,
    value,
    onChange,
    options,
}: {
    label: string
    ariaLabel: string
    value: string
    onChange: (value: string) => void
    options: string[]
}) {
    return (
        <div className="filter-control">
            <span className="filter-label">{label}</span>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                aria-label={ariaLabel}
            >
                <option value="all">All</option>
                {options.map((opt) => (
                    <option key={opt} value={opt}>
                        {opt}
                    </option>
                ))}
            </select>
        </div>
    )
}

function StateCard({
    message,
    actionLabel,
    onAction,
    extraClass,
}: {
    message: string
    actionLabel: string
    onAction: () => void
    extraClass?: string
}) {
    return (
        <div className={`state-card${extraClass ? ` ${extraClass}` : ""}`}>
            <strong>{message}</strong>
            <button type="button" onClick={onAction} className="retry-button">
                {actionLabel}
            </button>
        </div>
    )
}

/* ---------- main component ---------- */

export default function Courses(props: { title: string; cardAccent: string }) {
    const { title, cardAccent } = props

    const [courses, setCourses] = React.useState<Course[]>([])
    const [country, setCountry] = React.useState<Country>(null)
    const [loading, setLoading] = React.useState(true)
    const [error, setError] = React.useState<string | null>(null)

    const [search, setSearch] = React.useState("")
    const [category, setCategory] = React.useState("all")
    const [courseType, setCourseType] = React.useState("all")
    const [sortBy, setSortBy] = React.useState<SortOption>("default")
    const [refundableOnly, setRefundableOnly] = React.useState(false)

    // Tracks the in-flight request so a retry can abort whatever came
    // before it, and so a superseded request knows not to touch state
    // once a newer one has taken over.
    const loadControllerRef = React.useRef<AbortController | null>(null)

    // Use the selected accent as the first color in the card rotation.
    const accents = React.useMemo(
        () => [
            { background: cardAccent, foreground: "#FFFFFF" },
            ...ACCENTS.slice(1),
        ],
        [cardAccent]
    )

    const loadCourses = React.useCallback(async () => {
        // Abort any earlier request so it can't resolve later and
        // overwrite fresher data from this call.
        loadControllerRef.current?.abort()
        const controller = new AbortController()
        loadControllerRef.current = controller

        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

        setLoading(true)
        setError(null)
        setCountry(null) // country is re-resolved on every load; a stale value is worse than none

        try {
            // Independent requests: a course failure is a section error, a country
            // failure just means prices are shown as unavailable.
            const [coursesResult, countryResult] = await Promise.allSettled([
                fetch(COURSE_URL, {
                    method: "GET",
                    signal: controller.signal,
                }),
                fetch(COUNTRY_URL, {
                    method: "GET",
                    signal: controller.signal,
                }),
            ])

            // A newer retry has already taken over; let it own the state.
            if (loadControllerRef.current !== controller) return

            if (
                coursesResult.status === "rejected" ||
                !coursesResult.value.ok
            ) {
                throw new Error("Unable to load courses.")
            }

            const courseData = await coursesResult.value.json()
            if (
                !Array.isArray(courseData) ||
                !courseData.every(isValidCourse)
            ) {
                throw new Error("Invalid course data.")
            }
            setCourses(courseData)

            if (
                countryResult.status === "fulfilled" &&
                countryResult.value.ok
            ) {
                const countryData = await countryResult.value
                    .json()
                    .catch(() => null)
                const code = countryData?.country_code
                setCountry(code === "IN" || code === "US" ? code : null)
            }
        } catch {
            // Ignore errors from a request that's since been superseded
            // (including its own abort when a retry fires).
            if (loadControllerRef.current !== controller) return
            setCourses([])
            setCountry(null)
            setError("Something went wrong while loading the courses.")
        } finally {
            clearTimeout(timeoutId)
            if (loadControllerRef.current === controller) {
                setLoading(false)
            }
        }
    }, [])

    React.useEffect(() => {
        loadCourses()
    }, [loadCourses])

    const getPrice = React.useCallback(
        (course: Course): number | null =>
            country === "IN"
                ? course.pricePaise / 100
                : country === "US"
                  ? course.priceUsdCents / 100
                  : null,
        [country]
    )

    const formatPrice = React.useCallback(
        (course: Course) => {
            const amount = getPrice(course)
            if (amount === null) return "Price unavailable"
            return new Intl.NumberFormat(country === "IN" ? "en-IN" : "en-US", {
                style: "currency",
                currency: country === "IN" ? "INR" : "USD",
                maximumFractionDigits: country === "IN" ? 0 : 2,
            }).format(amount)
        },
        [country, getPrice]
    )

    const uniqueValues = (key: "mainCategory" | "courseType") =>
        Array.from(new Set(courses.map((c) => c[key]).filter(Boolean))).sort()

    const categories = React.useMemo(
        () => uniqueValues("mainCategory"),
        [courses]
    )
    const courseTypes = React.useMemo(
        () => uniqueValues("courseType"),
        [courses]
    )

    const filteredCourses = React.useMemo(() => {
        const query = search.trim().toLowerCase()

        let result = courses.filter((course) => {
            const searchable =
                `${course.courseName} ${course.mainCategory} ${course.courseType} ${course.shortCourse} ${course.description}`.toLowerCase()
            return (
                (!query || searchable.includes(query)) &&
                (category === "all" || course.mainCategory === category) &&
                (courseType === "all" || course.courseType === courseType) &&
                (!refundableOnly || course.refundable === true)
            )
        })

        // Price sorting only makes sense once a currency is known.
        if (sortBy === "price-low" && country)
            result = [...result].sort(
                (a, b) => (getPrice(a) ?? 0) - (getPrice(b) ?? 0)
            )
        if (sortBy === "price-high" && country)
            result = [...result].sort(
                (a, b) => (getPrice(b) ?? 0) - (getPrice(a) ?? 0)
            )

        return result
    }, [
        courses,
        search,
        category,
        courseType,
        sortBy,
        refundableOnly,
        country,
        getPrice,
    ])

    // If country becomes unavailable while price sorting is active, fall back to default.
    React.useEffect(() => {
        if (!country && (sortBy === "price-low" || sortBy === "price-high"))
            setSortBy("default")
    }, [country, sortBy])

    const hasActiveFilters =
        search.trim() !== "" ||
        category !== "all" ||
        courseType !== "all" ||
        sortBy !== "default" ||
        refundableOnly

    const clearFilters = () => {
        setSearch("")
        setCategory("all")
        setCourseType("all")
        setSortBy("default")
        setRefundableOnly(false)
    }

    return (
        <>
            <style>{responsiveStyles}</style>

            <section className="skillpath-courses">
                <div className="courses-container">
                    <div className="catalogue-header">
                        <h2 className="catalogue-heading">{title}</h2>
                        <p className="catalogue-description">
                            Practical courses built around real skills and real
                            work.
                        </p>
                    </div>

                    {!loading && !error && (
                        <div className="filter-bar">
                            <div className="search-wrapper">
                                <span aria-hidden className="search-icon">
                                    /
                                </span>
                                <input
                                    className="search-input"
                                    type="search"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder="Search courses..."
                                    aria-label="Search courses"
                                />
                            </div>

                            <div className="filters">
                                <FilterSelect
                                    label="CATEGORY"
                                    ariaLabel="Filter by category"
                                    value={category}
                                    onChange={setCategory}
                                    options={categories}
                                />
                                <FilterSelect
                                    label="TYPE"
                                    ariaLabel="Filter by course type"
                                    value={courseType}
                                    onChange={setCourseType}
                                    options={courseTypes}
                                />

                                <div className="filter-control">
                                    <span className="filter-label">SORT</span>
                                    <select
                                        value={sortBy}
                                        onChange={(e) =>
                                            setSortBy(
                                                e.target.value as SortOption
                                            )
                                        }
                                        aria-label="Sort courses"
                                    >
                                        <option value="default">Default</option>
                                        {country && (
                                            <>
                                                <option value="price-low">
                                                    Price: Low → High
                                                </option>
                                                <option value="price-high">
                                                    Price: High → Low
                                                </option>
                                            </>
                                        )}
                                    </select>
                                </div>

                                <label className="refundable-control">
                                    <input
                                        type="checkbox"
                                        checked={refundableOnly}
                                        onChange={(e) =>
                                            setRefundableOnly(e.target.checked)
                                        }
                                    />
                                    <span>REFUNDABLE</span>
                                </label>

                                {hasActiveFilters && (
                                    <button
                                        type="button"
                                        onClick={clearFilters}
                                        className="clear-button"
                                    >
                                        CLEAR
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    {!loading && !error && courses.length > 0 && !country && (
                        <div className="country-warning">
                            PRICES ARE TEMPORARILY UNAVAILABLE.
                        </div>
                    )}

                    {loading && (
                        <div className="course-grid">
                            {Array.from({ length: 6 }).map((_, i) => (
                                <article
                                    key={i}
                                    className="course-card skeleton-card"
                                >
                                    <div className="skeleton-header" />
                                    <div className="card-body">
                                        <div className="skeleton-title" />
                                        <div className="skeleton-line" />
                                        <div className="skeleton-line short" />
                                        <div className="skeleton-divider" />
                                        <div className="skeleton-price" />
                                    </div>
                                </article>
                            ))}
                        </div>
                    )}

                    {!loading && error && (
                        <StateCard
                            message={error}
                            actionLabel="RETRY"
                            onAction={loadCourses}
                        />
                    )}

                    {!loading && !error && courses.length === 0 && (
                        <StateCard
                            message="No courses available right now."
                            actionLabel="RETRY"
                            onAction={loadCourses}
                        />
                    )}

                    {!loading &&
                        !error &&
                        courses.length > 0 &&
                        filteredCourses.length === 0 && (
                            <StateCard
                                message="No courses match your filters."
                                actionLabel="CLEAR FILTERS"
                                onAction={clearFilters}
                                extraClass="filtered-empty"
                            />
                        )}

                    {!loading && !error && filteredCourses.length > 0 && (
                        <div className="course-grid">
                            {filteredCourses.map((course, index) => {
                                const accent = accents[index % accents.length]
                                return (
                                    <article
                                        key={course.courseCode}
                                        className="course-card"
                                    >
                                        <div
                                            className="card-header"
                                            style={{
                                                background: accent.background,
                                                color: accent.foreground,
                                            }}
                                        >
                                            <div
                                                aria-hidden
                                                className="card-halftone"
                                            />
                                            <span className="category">
                                                {course.mainCategory}
                                            </span>
                                            <span className="number">
                                                {String(index + 1).padStart(
                                                    2,
                                                    "0"
                                                )}
                                            </span>
                                        </div>

                                        <div className="card-body">
                                            <h3 className="course-name">
                                                {course.courseName}
                                            </h3>
                                            <p className="course-description">
                                                {course.description}
                                            </p>

                                            <div className="card-bottom">
                                                <div className="divider" />
                                                <div className="price-row">
                                                    <span
                                                        className={
                                                            country
                                                                ? "course-price"
                                                                : "course-price unavailable"
                                                        }
                                                    >
                                                        {formatPrice(course)}
                                                    </span>
                                                    {course.refundable ===
                                                        true && (
                                                        <span className="refundable-badge">
                                                            REFUNDABLE
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="course-type">
                                                    {course.courseType}
                                                </div>
                                            </div>
                                        </div>
                                    </article>
                                )
                            })}
                        </div>
                    )}
                </div>
            </section>
        </>
    )
}

/* ---------- responsive CSS (values unchanged from the original — formatting only) ---------- */

const responsiveStyles = `
    * { box-sizing: border-box; }

    .skillpath-courses { width: 100%; min-width: 0; background: #F7F0DE; padding: 72px 24px 96px; overflow-x: hidden; }
    .courses-container { width: 100%; max-width: 1200px; margin: 0 auto; }

    /* CATALOGUE HEADER */
    .catalogue-header { width: 100%; max-width: 700px; padding-bottom: 24px; border-bottom: 3px solid #0B0D12; }
    .catalogue-heading {
        margin: 0; font-family: "Avario Black", "Arial Black", sans-serif; font-size: clamp(42px, 5.5vw, 76px);
        line-height: 0.92; letter-spacing: -0.045em; text-transform: uppercase; color: #0B0D12;
    }
    .catalogue-description { margin: 22px 0 0; font-family: "Space Grotesk", Arial, sans-serif; font-size: 16px; line-height: 1.5; color: #34425A; }

    /* FILTER BAR */
    .filter-bar { width: 100%; margin-top: 28px; display: flex; align-items: stretch; border: 3px solid #0B0D12; background: #FFFDF8; box-shadow: 6px 6px 0 #0B0D12; }
    .search-wrapper { position: relative; flex: 1 1 280px; min-width: 0; display: flex; align-items: center; }
    .search-icon { position: absolute; left: 17px; top: 50%; transform: translateY(-50%) rotate(45deg); font-family: "Avario Black", "Arial Black", sans-serif; color: #0B0D12; pointer-events: none; }
    .search-input { width: 100%; height: 56px; border: 0; outline: 0; background: transparent; padding: 0 16px 0 43px; font-family: "Space Grotesk", Arial, sans-serif; font-size: 15px; color: #0B0D12; }
    .search-input::placeholder { color: #526079; opacity: 1; }
    .search-input::-webkit-search-cancel-button { cursor: pointer; }

    .filters { min-width: 0; display: flex; align-items: stretch; border-left: 2px solid #0B0D12; }
    .filter-control { min-width: 0; height: 56px; display: flex; align-items: center; gap: 8px; padding: 0 14px; border-right: 2px solid #0B0D12; }
    .filter-label { flex-shrink: 0; font-family: "Avario Black", "Arial Black", sans-serif; font-size: 9px; letter-spacing: 0.15em; color: #526079; }
    .filter-control select { min-width: 0; max-width: 120px; border: 0; outline: 0; background: transparent; font-family: "Avario Black", "Arial Black", sans-serif; font-size: 11px; color: #0B0D12; cursor: pointer; }

    .refundable-control { height: 56px; display: flex; align-items: center; gap: 8px; padding: 0 14px; border-right: 2px solid #0B0D12; font-family: "Avario Black", "Arial Black", sans-serif; font-size: 9px; letter-spacing: 0.12em; white-space: nowrap; cursor: pointer; }
    .refundable-control input { width: 15px; height: 15px; margin: 0; accent-color: #FF3155; cursor: pointer; }

    .clear-button { min-height: 56px; border: 0; padding: 0 15px; background: #FF3155; color: #FFFFFF; font-family: "Avario Black", "Arial Black", sans-serif; font-size: 10px; letter-spacing: 0.12em; cursor: pointer; }
    .clear-button:hover, .retry-button:hover { transform: translate(2px, 2px); }

    .country-warning { margin-top: 24px; font-family: "Avario Black", "Arial Black", sans-serif; font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: #526079; }

    /* GRID */
    .course-grid { width: 100%; margin-top: 40px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 28px; }

    /* CARD */
    .course-card { width: 100%; min-width: 0; min-height: 320px; display: flex; flex-direction: column; background: #FFFDF8; border: 3px solid #0B0D12; box-shadow: 7px 7px 0 #0B0D12; overflow: hidden;transition: transform 180ms ease, box-shadow 180ms ease; }
    .course-card:hover {
    transform: translate(4px, 4px);
    box-shadow: 3px 3px 0 #0B0D12;
    }
    .card-header { position: relative; min-width: 0; min-height: 45px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 18px; border-bottom: 3px solid #0B0D12; overflow: hidden; }
    .card-halftone { position: absolute; inset: 0; background-image: radial-gradient(rgba(11, 13, 18, 0.5) 1px, transparent 1.2px); background-size: 5px 5px; opacity: 0.22; pointer-events: none; }
    .category { position: relative; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: "Avario Black", "Arial Black", sans-serif; font-size: 10px; letter-spacing: 0.17em; text-transform: uppercase; }
    .number { position: relative; flex-shrink: 0; font-family: "Avario Black", "Arial Black", sans-serif; font-size: 10px; letter-spacing: 0.1em; }

    .card-body { min-width: 0; flex: 1; display: flex; flex-direction: column; padding: 26px 24px; }
    .course-name { margin: 0; font-family: "Avario Black", "Arial Black", sans-serif; font-size: 27px; line-height: 1; letter-spacing: -0.025em; text-transform: uppercase; color: #0B0D12; overflow-wrap: break-word; }
    .course-description { margin: 18px 0 0; min-width: 0; min-height: 47px; font-family: "Space Grotesk", Arial, sans-serif; font-size: 15px; line-height: 1.55; color: #34425A; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

    .card-bottom { margin-top: auto; padding-top: 25px; }
    .divider { width: 100%; height: 2px; background: #0B0D12; margin-bottom: 18px; }
    .price-row { min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .course-price { min-width: 0; font-family: "Avario Black", "Arial Black", sans-serif; font-size: 27px; line-height: 1; letter-spacing: -0.025em; color: #0B0D12; overflow-wrap: anywhere; }
    .course-price.unavailable { font-family: "Space Grotesk", Arial, sans-serif; font-size: 16px; font-weight: 700; line-height: 1.2; letter-spacing: 0; max-width: 180px; }
    .refundable-badge { flex-shrink: 0; border: 2px solid #0B0D12; background: #FFFDF8; padding: 6px 9px; font-family: "Avario Black", "Arial Black", sans-serif; font-size: 9px; letter-spacing: 0.14em; color: #0B0D12; white-space: nowrap; }
    .course-type { margin-top: 15px; font-family: "Avario Black", "Arial Black", sans-serif; font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: #526079; }

    /* LOADING / SKELETON */
    .skeleton-card { min-height: 320px; }
    .skeleton-header { height: 45px; background: linear-gradient(90deg, #FF3155 25%, #ff6680 50%, #FF3155 75%); background-size: 400% 100%; animation: skillpathSkeleton 1.4s ease-in-out infinite; }
    .skeleton-card .card-body { padding: 26px 24px; }
    .skeleton-title { width: 75%; height: 27px; background: #D9D3C5; margin-bottom: 22px; }
    .skeleton-line { width: 100%; height: 12px; background: #E2DCCD; margin-bottom: 9px; }
    .skeleton-line.short { width: 72%; }
    .skeleton-divider { width: 100%; height: 2px; background: #D0C9BA; margin-top: auto; margin-bottom: 18px; }
    .skeleton-price { width: 100px; height: 25px; background: #D9D3C5; }
    @keyframes skillpathSkeleton { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

    /* ERROR / EMPTY */
    .state-card { width: 100%; margin-top: 40px; padding: 40px; display: flex; flex-direction: column; align-items: flex-start; gap: 22px; background: #FFFDF8; border: 3px solid #0B0D12; box-shadow: 6px 6px 0 #0B0D12; font-family: "Space Grotesk", Arial, sans-serif; font-size: 17px; color: #0B0D12; }
    .retry-button { border: 2px solid #0B0D12; background: #FF3155; color: #FFFFFF; padding: 12px 20px; font-family: "Avario Black", "Arial Black", sans-serif; font-size: 10px; letter-spacing: 0.14em; cursor: pointer; }
    .filtered-empty { margin-top: 40px; }

    /* TABLET: 601–900px */
    @media (max-width: 900px) {
        .skillpath-courses { padding: 64px 24px 80px; }
        .course-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; }

        /* stacked filters: search / category+type / sort+refundable / clear */
        .filter-bar { display: grid; grid-template-columns: 1fr; }
        .search-wrapper { width: 100%; border-bottom: 2px solid #0B0D12; }
        .filters { width: 100%; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-left: 0; }
        .filter-control, .refundable-control { width: 100%; min-width: 0; height: 58px; }
        .filter-control:nth-child(1), .filter-control:nth-child(3) { border-right: 2px solid #0B0D12; }
        .filter-control:nth-child(2) { border-right: 0; }
        .filter-control:nth-child(1), .filter-control:nth-child(2) { border-bottom: 2px solid #0B0D12; }
        .refundable-control { border-right: 0; }
        .clear-button { width: 100%; grid-column: 1 / -1; border-top: 2px solid #0B0D12; }

        .course-name { font-size: 24px; }
        .price-row { align-items: flex-start; flex-wrap: wrap; }
        .course-price { font-size: 25px; }
    }

    /* MOBILE: <= 600px */
    @media (max-width: 600px) {
        .skillpath-courses { padding: 48px 16px 72px; }
        .catalogue-header { max-width: 100%; padding-bottom: 22px; }
        .catalogue-heading { font-size: clamp(34px, 12vw, 48px); line-height: 0.94; letter-spacing: -0.04em; overflow-wrap: anywhere; }
        .catalogue-description { margin-top: 18px; font-size: 15px; }
        .filter-bar { margin-top: 24px; }
        .filters { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
        .filter-control { height: 60px; padding: 9px 12px; flex-direction: column; justify-content: center; align-items: flex-start; gap: 3px; }
        .filter-control select { width: 100%; max-width: none; font-size: 11px; }
        .refundable-control { height: 60px; padding: 0 12px; justify-content: flex-start; font-size: 9px; }

        .course-grid { grid-template-columns: 1fr; gap: 28px; margin-top: 32px; }
        .course-card { min-height: 300px; }
        .card-header { min-height: 44px; padding: 0 16px; }
        .card-body { padding: 24px 20px; }
        .course-name { font-size: 24px; line-height: 1.02; }
        .course-description { font-size: 15px; line-height: 1.5; }
        .price-row { flex-direction: column; align-items: flex-start; gap: 12px; }
        .course-price { font-size: 24px; }
        .course-price.unavailable { font-size: 15px; max-width: 100%; }
        .refundable-badge { font-size: 8px; }
        .state-card { padding: 28px 22px; font-size: 15px; }
    }

    /* VERY SMALL PHONES: <= 360px */
    @media (max-width: 360px) {
        .skillpath-courses { padding-left: 12px; padding-right: 12px; }
        .catalogue-heading { font-size: 34px; }
        .card-body { padding: 22px 18px; }
        .course-name { font-size: 22px; }
        .course-description { font-size: 14px; }
        .filter-label { font-size: 8px; }
        .filter-control select { font-size: 10px; }
    }
`

addPropertyControls(Courses, {
    title: {
        type: ControlType.String,
        title: "Title",
        defaultValue: "THE COURSE CATALOGUE",
    },
    cardAccent: {
        type: ControlType.Color,
        title: "Card Accent",
        defaultValue: "#FF3155",
    },
})
