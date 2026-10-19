import { useState } from 'react'

/** An import outcome: a new data file in use (`imported`, with what it is), or the file refused. */
interface ImportOutcomeShape<Info> {
  readonly status: 'imported' | 'refused'
  readonly info?: Info
}

/** What the last import did, shown under the import button. */
export type ImportState<Outcome, Info> =
  | { readonly status: 'idle' }
  | { readonly status: 'importing' }
  | {
      readonly status: 'done'
      readonly outcome: Outcome
      /** What was in use before the import (kept if the file was refused). */
      readonly previous: Info | null
    }
  | { readonly status: 'error'; readonly message: string }

/**
 * Runs an import (`run` asks the main process, which shows the file dialog) and remembers its
 * outcome. `onImported` hears about a newly imported file. `start` resolves with the outcome, or
 * null if an import is already running or the call failed.
 */
export function useImport<Info, Outcome extends ImportOutcomeShape<Info>>(
  run: () => Promise<Outcome | { readonly status: 'cancelled' }>,
  current: Info | null,
  onImported: (info: Info) => void
) {
  const [state, setState] = useState<ImportState<Outcome, Info>>({ status: 'idle' })

  async function start(): Promise<Outcome | { readonly status: 'cancelled' } | null> {
    if (state.status === 'importing') return null
    const previous = current
    setState({ status: 'importing' })
    try {
      const outcome = await run()
      if (outcome.status === 'cancelled') {
        setState({ status: 'idle' })
      } else {
        setState({ status: 'done', outcome, previous })
        if (outcome.status === 'imported' && outcome.info !== undefined) onImported(outcome.info)
      }
      return outcome
    } catch (error) {
      setState({ status: 'error', message: String(error) })
      return null
    }
  }

  return { state, busy: state.status === 'importing', start, clear: () => setState({ status: 'idle' }) }
}
