import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import './index.css';

function App() {
  const [incidentText, setIncidentText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleSubmit = async () => {
    if (!incidentText.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/api/resolve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ incidentText }),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch resolution');
      }

      const data = await response.json();
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>🚀 LO Incident Intelligence Assistant</h1>
        <p>AI-powered incident resolution and historical analysis</p>
      </header>

      <main className="app-main">
        <section className="input-section">
          <label htmlFor="incident-input">Describe the new incident:</label>
          <textarea
            id="incident-input"
            value={incidentText}
            onChange={(e) => setIncidentText(e.target.value)}
            placeholder="e.g. API gateway timeout when payload delivery happened"
            rows={5}
          />
          <button
            className="analyze-btn"
            onClick={handleSubmit}
            disabled={loading || !incidentText.trim()}
          >
            {loading ? 'Analyzing...' : '🔍 Get Recommended Resolution'}
          </button>
        </section>

        {error && <div className="error-message">{error}</div>}

        {result && (
          <div className="results-container">
            <section className="ai-recommendation">
              <h2>🤖 AI-Generated Recommended Resolution</h2>
              <div className="markdown-content">
                <ReactMarkdown>{result.aiRecommendation}</ReactMarkdown>
              </div>
            </section>

            <section className="similar-incidents">
              <h2>🧩 Top Similar Incidents</h2>
              {result.similarIncidents && result.similarIncidents.length > 0 ? (
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>Incident ID</th>
                        <th>Short Description</th>
                        <th>Similarity</th>
                        <th>Resolution</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.similarIncidents.map((inc, index) => (
                        <tr key={index}>
                          <td>{inc.incident_id}</td>
                          <td>{inc.short_desc}</td>
                          <td>{(inc.similarity * 100).toFixed(1)}%</td>
                          <td>{inc.resolution}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="no-data">No relevant historical incidents found.</p>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
