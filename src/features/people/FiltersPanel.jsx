import { AGE_DECADES, CLOTHING_SIZES, GENDERS, REGIONS } from '../../constants/polia.js'
import { Checkbox, Input, Select } from '../../components/ui.jsx'
import { cx } from '../../lib/cx.js'
import { QUICK_FILTERS, toggleValue } from './peopleFilters.js'

export function ToggleChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'rounded-full border px-3 py-1 text-sm transition-colors',
        active ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white text-stone-700 hover:border-stone-500',
      )}
    >
      {children}
    </button>
  )
}

export function QuickFilters({ filters, setFilters }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Rýchle filtre">
      {QUICK_FILTERS.map((qf) => (
        <ToggleChip
          key={qf.key}
          active={filters.quick.includes(qf.key)}
          onClick={() => setFilters((f) => ({ ...f, quick: toggleValue(f.quick, qf.key) }), `quick:${qf.key}`)}
        >
          {qf.label}
        </ToggleChip>
      ))}
    </div>
  )
}

function Group({ label, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

export function FiltersPanel({ filters, setFilters, waves }) {
  const toggleIn = (key, predKey) => (value) =>
    setFilters((f) => ({ ...f, [key]: toggleValue(f[key], value) }), predKey)

  const toggleGender = toggleIn('genders', 'genders')
  const toggleAge = toggleIn('ages', 'ages')
  const toggleSize = toggleIn('sizes', 'sizes')
  const toggleRegion = toggleIn('regions', 'regions')

  return (
    <div className="grid gap-4 rounded-xl border border-stone-200 bg-white p-4 md:grid-cols-2 xl:grid-cols-3">
      <Group label="Pohlavie">
        {GENDERS.map((g) => (
          <ToggleChip key={g} active={filters.genders.includes(g)} onClick={() => toggleGender(g)}>
            {g}
          </ToggleChip>
        ))}
      </Group>
      <Group label="Vek">
        {AGE_DECADES.map((d) => (
          <ToggleChip key={d.key} active={filters.ages.includes(d.key)} onClick={() => toggleAge(d.key)}>
            {d.label}
          </ToggleChip>
        ))}
      </Group>
      <Group label="Konfekcia">
        {CLOTHING_SIZES.map((s) => (
          <ToggleChip key={s} active={filters.sizes.includes(s)} onClick={() => toggleSize(s)}>
            {s}
          </ToggleChip>
        ))}
      </Group>
      <Group label="Región">
        {REGIONS.map((r) => (
          <ToggleChip key={r} active={filters.regions.includes(r)} onClick={() => toggleRegion(r)}>
            {r}
          </ToggleChip>
        ))}
      </Group>
      <Group label="Topánky">
        <div className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="decimal"
            min={15}
            max={55}
            step={0.5}
            placeholder="od"
            aria-label="Veľkosť topánok od"
            className="w-20"
            value={filters.shoeMin}
            onChange={(e) => setFilters({ shoeMin: e.target.value }, 'shoes')}
          />
          <span className="text-stone-400">–</span>
          <Input
            type="number"
            inputMode="decimal"
            min={15}
            max={55}
            step={0.5}
            placeholder="do"
            aria-label="Veľkosť topánok do"
            className="w-20"
            value={filters.shoeMax}
            onChange={(e) => setFilters({ shoeMax: e.target.value }, 'shoes')}
          />
        </div>
      </Group>
      <Group label="Registrácia / casting">
        <Select
          aria-label="Registračná vlna"
          placeholder="Všetky registrácie"
          value={filters.wave}
          onChange={(e) => setFilters({ wave: e.target.value }, 'wave')}
          options={waves.map((w) => ({ value: String(w.id), label: w.name }))}
          className="max-w-xs"
        />
        <Checkbox
          className="mt-1 w-full"
          label="Zobraziť aj neaktívne profily"
          checked={filters.inactive}
          onChange={(e) => setFilters({ inactive: e.target.checked })}
        />
      </Group>
    </div>
  )
}
