// Route-change motion: a single 120ms fade on the content region.
// template.jsx remounts per navigation, so the CSS animation re-runs.
export default function Template({ children }) {
  return <div className="route-fade">{children}</div>
}
