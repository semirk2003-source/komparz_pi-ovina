import { useState } from 'react'
import { usePhotoUrlState } from '../hooks/usePhotoUrl.js'
import { cx } from '../lib/cx.js'

// Fotka z neverejného úložiska cez dočasný podpísaný odkaz.
export function PersonPhoto({ path, alt = '', className }) {
  const { url, status } = usePhotoUrlState(path)
  const [brokenUrl, setBrokenUrl] = useState(null)

  if (status === 'empty') {
    return (
      <div className={cx('flex items-center justify-center bg-stone-100 text-xs text-stone-400', className)}>
        bez fotky
      </div>
    )
  }
  if (status === 'error' || (url && url === brokenUrl)) {
    return (
      <div className={cx('flex items-center justify-center bg-stone-100 text-xs text-stone-400', className)}>
        fotka sa nenačítala
      </div>
    )
  }
  if (status === 'loading') return <div className={cx('animate-pulse bg-stone-200', className)} />
  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={cx('object-cover', className)}
      onError={() => setBrokenUrl(url)}
    />
  )
}
