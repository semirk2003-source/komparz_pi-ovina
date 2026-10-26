import { useCallback } from 'react'
import { removeStorageFiles } from '../../api/people.js'
import { useToast } from '../../components/toast/ToastContext.js'

function showFailure(toast, failedFiles) {
  if (!failedFiles?.length) return
  toast.show({
    tone: 'error',
    duration: 20000,
    message: `Z úložiska sa nepodarilo zmazať ${failedFiles.length} súbor(ov): ${failedFiles.join(', ')}`,
    action: {
      label: 'Skúsiť znova',
      onClick: () =>
        removeStorageFiles(failedFiles)
          .then((stillFailed) => {
            if (stillFailed.length) showFailure(toast, stillFailed)
            else toast.show({ message: 'Súbory boli zmazané z úložiska.', tone: 'success' })
          })
          .catch(toast.error),
    },
  })
}

// Ak sa súbory fotiek nepodarilo zmazať z úložiska, povie to používateľovi
// (vrátane názvov súborov) a ponúkne opakovanie.
export function useStorageCleanup() {
  const toast = useToast()
  return useCallback((failedFiles) => showFailure(toast, failedFiles), [toast])
}
