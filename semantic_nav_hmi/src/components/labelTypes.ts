import { Building, Flag, House, MapPin, Route, SquareDashed, Trees, type LucideIcon } from 'lucide-react';

/** Label categories. Identity is carried by icon + name; all labels share one map colour. */
export const LABEL_TYPES: { value: string; label: string; icon: LucideIcon }[] = [
  { value: 'house', label: 'House', icon: House },
  { value: 'park', label: 'Park', icon: Trees },
  { value: 'road', label: 'Road', icon: Route },
  { value: 'building', label: 'Building', icon: Building },
  { value: 'landmark', label: 'Landmark', icon: Flag },
  { value: 'zone', label: 'Zone', icon: SquareDashed },
  { value: 'other', label: 'Other', icon: MapPin },
];

export function labelTypeInfo(type: string) {
  return LABEL_TYPES.find((t) => t.value === type) ?? { value: type, label: type || 'Other', icon: MapPin };
}
