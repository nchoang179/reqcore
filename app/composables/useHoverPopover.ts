/**
 * useHoverPopover — open/close state for a hover-triggered popover.
 *
 * Closing is deferred by a short grace period so the popover survives the
 * pointer crossing the gap between the trigger and the panel (and any
 * sub-pixel gaps between sibling elements), which otherwise reads as flicker.
 *
 * Usage:
 *   const { open, show, hide } = useHoverPopover()
 *   <div @mouseenter="show" @mouseleave="hide"> … </div>
 */
export function useHoverPopover(closeDelay = 150) {
  const open = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined

  function show() {
    clearTimeout(timer)
    open.value = true
  }

  function hide() {
    clearTimeout(timer)
    timer = setTimeout(() => {
      open.value = false
    }, closeDelay)
  }

  function close() {
    clearTimeout(timer)
    open.value = false
  }

  onBeforeUnmount(() => clearTimeout(timer))

  return { open, show, hide, close }
}
