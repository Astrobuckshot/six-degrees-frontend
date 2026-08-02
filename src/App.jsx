import { useState, useRef } from 'react'

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

function PathResult({ path, loading, error, searched }) {
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

  return (
    <div className="path-result">
      <div className="path-summary">
        {path.length - 1 === 0
          ? 'Same person!'
          : `Found in ${path.length - 1} step${path.length - 1 === 1 ? '' : 's'}`}
      </div>
      <ol className="path-steps">
        {path.map((step, i) => (
          <li key={`${step.id}-${i}`}>
            {i > 0 && (
              <div className="path-connection">
                {step.connectionType}
                {step.context ? ` (${step.context})` : ''}
              </div>
            )}
            <div className="path-person">{step.name}</div>
          </li>
        ))}
      </ol>
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
