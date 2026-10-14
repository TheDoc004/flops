/**
 * Today card stack — natural-height cards in the order `dashboardLayout.js` fixes.
 */
export default function DashboardCanvas({ order, cards }) {
  return (
    <div className="dashboard-stack">
      {order.map(id => (
        <div key={id} className="dashboard-card dashboard-card--view">
          {cards[id]}
        </div>
      ))}
    </div>
  );
}
