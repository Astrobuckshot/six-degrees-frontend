import { useState, useRef, useEffect } from 'react'

// Small helper: waits for the person to stop typing before searching,
// so we're not hammering the API on every keystroke.
function useDebouncedSearch(delay = 300) {
  const timeoutRef = useRef(null)

  function debounced(fn) {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(fn, delay)
  }

  return debounced
}

function PersonSearchBox({ label, selectedPerson, onSelect }) {
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(false)
  const debounce = useDebouncedSearch()

  function handleChange(e) {
    const value = e.target.value
    setQuery(value)

    if (value.trim().length < 2) {
      setMatches([])
      return
    }

    debounce(async () => {
      setLoading(true)
      try {
        const resp = await fetch(`/api/search-people?q=${encodeURIComponent(value)}`)
        const data = await resp.json()
        setMatches(data.matches || [])
      } catch (err) {
        console.error('Search failed:', err)
      } finally {
        setLoading(false)
      }
    })
  }

  function handleSelect(person) {
    onSelect(person)
    setQuery('')
    setMatches([])
  }

  function handleClear() {
    onSelect(null)
    setQuery('')
    setMatches([])
  }

  if (selectedPerson) {
    return (
      <div className="search-box">
        <label>{label}</label>
        <div className="selected-person">
          <span>{selectedPerson.name}</span>
          <button onClick={handleClear} aria-label={`Clear ${label}`}>
            &times;
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="search-box">
      <label htmlFor={`search-${label}`}>{label}</label>
      <input
        id={`search-${label}`}
        type="text"
        value={query}
        onChange={handleChange}
        placeholder="Type a name..."
        autoComplete="off"
      />
      {loading && <div className="search-status">Searching...</div>}
      {matches.length > 0 && (
        <ul className="match-list">
          {matches.map((person) => (
            <li key={person.id}>
              <button onClick={() => handleSelect(person)}>{person.name}</button>
            </li>
          ))}
        </ul>
      )}
      {!loading && query.trim().length >= 2 && matches.length === 0 && (
        <div className="search-status">No matches found.</div>
      )}
    </div>
  )
}

// Computes each person's position along a gentle downward arc between
// the two endpoints - mirrors the "Person A and B on the outer ends,
// with the path dipping down through the middle" sketch. Positions are
// fractions (0-1) of the container; converted to real pixels at render
// time so spacing stays consistent regardless of screen width.
function computeArcFractions(count) {
  const positions = []
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1)
    const x = 0.06 + t * 0.88
    const y = 0.16 + Math.sin(t * Math.PI) * 0.60
    positions.push({ x, y })
  }
  return positions
}

function getInitial(name) {
  return name ? name.trim().charAt(0).toUpperCase() : '?'
}

function PathResult({ path, loading, error, searched }) {
  const containerRef = useRef(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current

    function measure() {
      const width = el.offsetWidth
      setSize({ width, height: width * 0.62 })
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [path])

  if (loading) {
    return <div className="result-status">Searching for a connection...</div>
  }

  if (error) {
    return <div className="result-status result-error">Something went wrong: {error}</div>
  }

  if (!searched) {
    return null
  }

  if (path === null) {
    return (
      <div className="result-status">
        No connection found between these two people yet. As the database grows, a path
        may appear later.
      </div>
    )
  }

  const fractions = computeArcFractions(path.length)
  const positions = fractions.map((f) => ({ x: f.x * size.width, y: f.y * size.height }))
  const REVEAL_STEP_SECONDS = 0.4
  const ready = size.width > 0

  // Frame size scales down on narrow screens instead of staying fixed,
  // so photos don't dominate a small mobile viewport. Everything else
  // (label clearance) is computed FROM this, so spacing stays correct
  // at any screen size rather than only looking right at one width.
  const frameWidth = Math.max(52, Math.min(74, size.width * 0.105))
  const frameHeight = frameWidth * (96 / 74)
  const frameHalfHeight = frameHeight / 2

  return (
    <div className="path-result">
      <div className="path-summary">
        {path.length - 1 === 0
          ? 'Same person'
          : `Found in ${path.length - 1} step${path.length - 1 === 1 ? '' : 's'}`}
      </div>

      <div className="path-arc-container" ref={containerRef}>
        {ready && (
          <>
            <svg className="path-arc-svg" viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none">
              {positions.slice(1).map((pos, idx) => {
                const prev = positions[idx]
                const delay = (idx + 1) * REVEAL_STEP_SECONDS
                return (
                  <path
                    key={idx}
                    d={`M ${prev.x} ${prev.y} L ${pos.x} ${pos.y}`}
                    style={{ animationDelay: `${delay}s` }}
                  />
                )
              })}
            </svg>

            {path.map((step, i) => {
              const pos = positions[i]
              const delay = i * REVEAL_STEP_SECONDS
              return (
                <div
                  key={`${step.id}-${i}`}
                  className="path-node"
                  style={{ left: `${pos.x}px`, top: `${pos.y}px`, animationDelay: `${delay}s` }}
                >
                  <div
                    className="path-node-frame"
                    style={{ width: `${frameWidth}px`, height: `${frameHeight}px` }}
                  >
                    <div className="path-node-photo">
                      {step.photoUrl ? (
                        <img src={step.photoUrl} alt={step.name} loading="lazy" />
                      ) : (
                        <span className="path-node-initial">{getInitial(step.name)}</span>
                      )}
                    </div>
                  </div>
                  <div className="path-node-name">{step.name}</div>
                </div>
              )
            })}

            {positions.slice(1).map((pos, idx) => {
              const prev = positions[idx]
              const step = path[idx + 1]
              const delay = (idx + 1) * REVEAL_STEP_SECONDS + 0.15
              const label = step.connectionType + (step.context ? ` · ${step.context}` : '')

              const midX = (prev.x + pos.x) / 2
              let labelX, labelY

              if (Math.abs(prev.y - pos.y) < 1) {
                // Same depth (e.g. two people at the bottom of the arc):
                // stay centered between them, lowered enough to clear
                // both frames and not crowd the name row beneath them.
                labelX = midX
                labelY = prev.y + frameHalfHeight + frameHalfHeight * 1.1
              } else {
                // Diagonal segment: hang mostly under the OUTER (shallower)
                // person's own column - roughly vertically parallel to
                // them - rather than centered between the pair, and sit
                // well down the segment rather than near the top.
                const shallow = prev.y <= pos.y ? prev : pos
                const deep = prev.y <= pos.y ? pos : prev
                labelX = shallow.x * 0.85 + deep.x * 0.15
                const proportional = shallow.y + (deep.y - shallow.y) * 0.65
                const clearOfName = shallow.y + frameHalfHeight + 34 // guaranteed below the name text, any screen size
                labelY = Math.max(proportional, clearOfName)
              }

              return (
                <div
                  key={idx}
                  className="path-connection-label"
                  style={{ left: `${labelX}px`, top: `${labelY}px`, animationDelay: `${delay}s` }}
                >
                  {label}
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}

export default function App() {
  const [personA, setPersonA] = useState(null)
  const [personB, setPersonB] = useState(null)
  const [path, setPath] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [searched, setSearched] = useState(false)

  async function handleFindConnection() {
    setLoading(true)
    setError(null)
    setSearched(true)
    try {
      const resp = await fetch(`/api/find-path?a=${personA.id}&b=${personB.id}`)
      const data = await resp.json()
      if (data.error) {
        setError(data.error)
        setPath(null)
      } else {
        setPath(data.path)
      }
    } catch (err) {
      setError(err.message)
      setPath(null)
    } finally {
      setLoading(false)
    }
  }

  const canSearch = personA && personB && !loading

  return (
    <div className="app">
      <h1>Six Degrees</h1>
      <p className="subtitle">Find the connection between any two people.</p>

      <div className="search-row">
        <PersonSearchBox label="Person A" selectedPerson={personA} onSelect={setPersonA} />
        <PersonSearchBox label="Person B" selectedPerson={personB} onSelect={setPersonB} />
      </div>

      <button className="find-button" disabled={!canSearch} onClick={handleFindConnection}>
        Find Connection
      </button>

      <PathResult path={path} loading={loading} error={error} searched={searched} />
    </div>
  )
}
