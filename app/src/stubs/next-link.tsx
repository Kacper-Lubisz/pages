import { forwardRef, type ReactNode } from 'react'

// Stub for next/link so catalyst-ui-kit (and other app components that import it) render
// under the plan daemon without a Next.js router context. Renders a plain <a>.
export default forwardRef<HTMLAnchorElement, { href?: unknown; children?: ReactNode } & Record<string, unknown>>(
  function NextLink({ href, children, ...rest }, ref) {
    return <a ref={ref} href={typeof href === 'string' ? href : '#'} {...(rest as object)}>{children}</a>
  },
)
