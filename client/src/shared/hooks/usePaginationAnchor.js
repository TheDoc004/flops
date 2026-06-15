import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Page state + scroll anchoring for paginated lists (Recipe / Ingredient
 * libraries). Keeps the pagination controls visually fixed in the viewport when
 * flipping pages, so the page doesn't jump as the list height changes.
 *
 * Usage:
 *   const { page, setPage, paginationRef, handlePageChange } = usePaginationAnchor();
 *   ...attach paginationRef to the controls container; call handlePageChange(n) on Prev/Next.
 *
 * @returns {{ page: number, setPage: Function, paginationRef: object, handlePageChange: (n:number)=>void }}
 */
export default function usePaginationAnchor() {
  const [page, setPage] = useState(1);
  const paginationRef = useRef(null);
  const pendingTopRef = useRef(null);

  function handlePageChange(nextPage) {
    pendingTopRef.current = paginationRef.current?.getBoundingClientRect().top ?? null;
    setPage(nextPage);
  }

  useLayoutEffect(() => {
    const beforeTop = pendingTopRef.current;
    if (beforeTop == null) return;
    requestAnimationFrame(() => {
      const afterTop = paginationRef.current?.getBoundingClientRect().top;
      if (afterTop == null) return;
      const delta = afterTop - beforeTop;
      if (Math.abs(delta) > 8) {
        window.scrollBy({ top: delta, behavior: 'auto' });
      }
      pendingTopRef.current = null;
    });
  }, [page]);

  return { page, setPage, paginationRef, handlePageChange };
}
