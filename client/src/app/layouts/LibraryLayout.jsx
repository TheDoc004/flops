import { Outlet, useLocation } from 'react-router-dom';
import LibrarySubNav from '@shared/ui/LibrarySubNav';

/**
 * Holds the Recipes ↔ Ingredients crossing so the segmented control does not
 * remount on each hop — that remount is why the pill used to teleport.
 */
export default function LibraryLayout() {
  const { pathname } = useLocation();
  return (
    <div>
      <LibrarySubNav />
      <div key={pathname} className="library-outlet">
        <Outlet />
      </div>
    </div>
  );
}
