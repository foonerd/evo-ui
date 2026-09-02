import { useCallback, useState } from "preact/hooks";

interface AsyncActionState {
  loading: boolean;
  error: string | null;
  successMessage: string | null;
}

const INITIAL_STATE: AsyncActionState = {
  loading: false,
  error: null,
  successMessage: null
};

export function useAsyncAction() {
  const [state, setState] = useState<AsyncActionState>(INITIAL_STATE);

  const run = useCallback(
    async (
      operation: () => Promise<unknown>,
      successMessage: string | ((result: unknown) => string)
    ): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> => {
    setState({ loading: true, error: null, successMessage: null });
    try {
      const result = await operation();
      setState({
        loading: false,
        error: null,
        successMessage:
          typeof successMessage === "function" ? successMessage(result) : successMessage
      });
      return { ok: true, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Operation failed";
      setState({
        loading: false,
        error: message,
        successMessage: null
      });
      return { ok: false, error: message };
    }
  }, []);

  return {
    ...state,
    run
  };
}
