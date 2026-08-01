import type { PaperSection, SectionName } from '../../types';

export function sectionAt(sections: PaperSection[], offset: number): SectionName {
  for (const s of sections) {
    if (offset >= s.startOffset && offset < s.endOffset) return s.name;
  }
  return 'Other';
}
