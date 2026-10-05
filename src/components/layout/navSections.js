export const NAV_SECTIONS = [
  {
    category: 'OPERATIONS',
    items: [
      {
        path: '/command-centre',
        label: 'Command Centre',
        description: 'Situational awareness & priority map',
        icon: 'command',
      },
      {
        path: '/forecast',
        label: 'Forecast Workspace',
        description: 'Multi-model trajectories & timeline',
        icon: 'cloud',
      },
      {
        path: '/extremes',
        label: 'Extremes Watch',
        description: 'IMD-calibrated meteorological hazards',
        icon: 'alert',
      },
    ],
  },
  {
    category: 'ANALYSIS',
    items: [
      {
        path: '/explainability',
        label: 'Explainability',
        description: 'Adaptive weights & model attribution',
        icon: 'brain',
      },
      {
        path: '/models',
        label: 'Models & Optimization',
        description: '4-NWP physics & adaptive analysis',
        icon: 'layers',
      },
      {
        path: '/skill',
        label: 'Verification Skill',
        description: 'Held-out accuracy vs ERA5 reference',
        icon: 'chart',
      },
    ],
  },
  {
    category: 'SYSTEM',
    items: [
      {
        path: '/system',
        label: 'System & Gateway Health',
        description: 'Open-Meteo gateway & pipeline telemetry',
        icon: 'gear',
      },
    ],
  },
];
