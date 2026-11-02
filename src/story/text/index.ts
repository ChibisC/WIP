import { EN } from './en';

/** A story string by key (the narration, tips and journal pages); '' when missing. */
export function storyText(key: string): string {
  return EN[key] ?? '';
}

export { EN };
