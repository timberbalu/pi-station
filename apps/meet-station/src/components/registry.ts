import type { StationComponent } from './StationComponent.js';
import { VideoComponent } from './video/VideoComponent.js';

const KNOWN_COMPONENT_IDS = ['voice', 'video'] as const;
type KnownComponentId = typeof KNOWN_COMPONENT_IDS[number];

/**
 * Parse ENABLED_COMPONENTS env var and build the component list.
 * VoiceComponent is passed in pre-constructed (it has voice-specific deps).
 * Other components are instantiated here from their ids.
 *
 * Throws clearly on unknown component ids — startup fails loudly.
 */
export function buildComponentRegistry(
  enabledIds: string[],
  voice: StationComponent,
): StationComponent[] {
  const components: StationComponent[] = [];

  for (const raw of enabledIds) {
    const id = raw.trim() as KnownComponentId;

    if (id === 'voice') {
      components.push(voice);
      continue;
    }

    if (id === 'video') {
      components.push(new VideoComponent());
      continue;
    }

    if (!KNOWN_COMPONENT_IDS.includes(id)) {
      throw new Error(
        `Unknown component id: "${id}". Known components: ${KNOWN_COMPONENT_IDS.join(', ')}. ` +
        `Check your ENABLED_COMPONENTS env var.`,
      );
    }
  }

  return components;
}

export function parseEnabledComponents(raw: string): string[] {
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}
