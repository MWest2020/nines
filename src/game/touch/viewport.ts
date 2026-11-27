// Keeps a full-screen DOM overlay inside the part of the page that is visible. When a soft
// keyboard opens, Chrome on Android shrinks the page itself (the viewport meta asks for
// interactive-widget=resizes-content); other browsers only shrink the visual viewport and leave
// the keyboard over the bottom of the page. Then the overlay is fitted to the visual viewport,
// so the terminal's input line and quick strip stay above the keyboard.

export function followVisualViewport(el: HTMLElement): () => void {
  const vv = typeof window === 'undefined' ? null : window.visualViewport;
  if (!vv) return () => {};
  const apply = () => {
    // a pinch zoom also shrinks the visual viewport: leave that alone, it is the player's
    const covered = Math.abs(vv.scale - 1) < 0.01 && (window.innerHeight - vv.height > 1 || vv.offsetTop > 0);
    el.style.top = covered ? `${vv.offsetTop}px` : '';
    el.style.height = covered ? `${vv.height}px` : '';
    el.style.bottom = covered ? 'auto' : '';
    el.classList.toggle('vv-fitted', covered);
  };
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  apply();
  return () => {
    vv.removeEventListener('resize', apply);
    vv.removeEventListener('scroll', apply);
  };
}
