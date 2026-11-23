const STYLES = {
  completed: 'bg-green-600 text-white',
  pending: 'bg-yellow-300 text-gray-900',
  failed: 'bg-red-600 text-white',
  cancelled: 'bg-gray-300 text-gray-900',
};

// Colour-coded pill: "completed" -> green, "pending" -> yellow, "failed" -> red, "cancelled" -> gray.
export default function StatusBadge({ status }) {
  const style = STYLES[status] || 'bg-gray-100 text-gray-700';
  const label = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';
  return <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${style}`}>{label}</span>;
}
