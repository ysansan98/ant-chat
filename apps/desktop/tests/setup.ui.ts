import { vi } from 'vitest'
import './setup.common'
import '@testing-library/jest-dom/vitest'

// jsdom does not implement scrollTo on elements
Element.prototype.scrollTo = vi.fn()
