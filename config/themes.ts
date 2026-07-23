const PRESETS: Record<string, any> = {
    default: {
        label: 'Default (dark)',
        light: {
            bg: '#f8fafc',
            card: '#ffffff',
            navbar: '#f1f5f9',
            text: '#0f172a',
            subtext: '#475569',
            highlight: '#10b981'
        },
        dark: {
            bg: '#171717',
            card: '#262626',
            navbar: '#0a0a0a',
            text: '#ffffff',
            subtext: '#ffffff',
            highlight: '#10b981'
        }
    },

    emerald: {
        label: 'Emerald',
        light: {
            bg: '#f0fdf4',
            card: '#ffffff',
            navbar: '#dcfce7',
            text: '#064e3b',
            subtext: '#166534',
            highlight: '#059669'
        },
        dark: {
            bg: '#022c22',
            card: '#064e3b',
            navbar: '#065f46',
            text: '#ecfdf5',
            subtext: '#ecfdf5',
            highlight: '#34d399'
        }
    },

    pink: {
        label: 'Pink',
        light: {
            bg: '#fdf2f8',
            card: '#ffffff',
            navbar: '#fce7f3',
            text: '#500724',
            subtext: '#9d174d',
            highlight: '#db2777'
        },
        dark: {
            bg: '#380620',
            card: '#831843',
            navbar: '#500724',
            text: '#fdf2f8',
            subtext: '#fdf2f8',
            highlight: '#f472b6'
        }
    },

    blue: {
        label: 'Ocean',
        light: {
            bg: '#eff6ff',
            card: '#ffffff',
            navbar: '#dbeafe',
            text: '#172554',
            subtext: '#1e40af',
            highlight: '#3b82f6'
        },
        dark: {
            bg: '#0f172a',
            card: '#1e293b',
            navbar: '#172554',
            text: '#eff6ff',
            subtext: '#eff6ff',
            highlight: '#60a5fa'
        }
    },

    amber: {
        label: 'Amber',
        light: {
            bg: '#fffbeb',
            card: '#ffffff',
            navbar: '#fef3c7',
            text: '#451a03',
            subtext: '#92400e',
            highlight: '#f59e0b'
        },
        dark: {
            bg: '#2e1003',
            card: '#451a03',
            navbar: '#78350f',
            text: '#fffbeb',
            subtext: '#fffbeb',
            highlight: '#fbbf24'
        }
    },

    purple: {
        label: 'Purple',
        light: {
            bg: '#faf5ff',
            card: '#ffffff',
            navbar: '#f3e8ff',
            text: '#2e1065',
            subtext: '#6b21a8',
            highlight: '#8b5cf6'
        },
        dark: {
            bg: '#2e1065',
            card: '#4c1d95',
            navbar: '#5b21b6',
            text: '#f3e8ff',
            subtext: '#f3e8ff',
            highlight: '#a78bfa'
        }
    },

    sakura: {
        label: 'Sakura',
        light: {
            bg: '#fce8f3',
            card: '#ffffff',
            navbar: '#f5d0e8',
            text: '#4a1a35',
            subtext: '#8b4a6b',
            highlight: '#d4679a'
        },
        dark: {
            bg: '#a8527a',
            card: '#be6a90',
            navbar: '#963d6b',
            text: '#fff0f8',
            subtext: '#ffd6ed',
            highlight: '#ffb3d9'
        }
    },

    cyan: {
        label: 'Cyan',
        light: {
            bg: '#ecfeff',
            card: '#ffffff',
            navbar: '#cffafe',
            text: '#083344',
            subtext: '#0e7490',
            highlight: '#06b6d4'
        },
        dark: {
            bg: '#061d27',
            card: '#083344',
            navbar: '#164e63',
            text: '#ecfeff',
            subtext: '#ecfeff',
            highlight: '#22d3ee'
        }
    },

    slate: {
        label: 'Slate',
        light: {
            bg: '#f8fafc',
            card: '#ffffff',
            navbar: '#e2e8f0',
            text: '#0f172a',
            subtext: '#334155',
            highlight: '#64748b'
        },
        dark: {
            bg: '#0f172a',
            card: '#1e293b',
            navbar: '#020617',
            text: '#f8fafc',
            subtext: '#f8fafc',
            highlight: '#94a3b8'
        }
    },

    forest: {
        label: 'Forest',
        light: {
            bg: '#f1f8f1',
            card: '#ffffff',
            navbar: '#d8eeda',
            text: '#1a3a1a',
            subtext: '#3a6b3a',
            highlight: '#4a8c4a'
        },
        dark: {
            bg: '#111f11',
            card: '#1a3a1a',
            navbar: '#0d160d',
            text: '#e8f5e8',
            subtext: '#e8f5e8',
            highlight: '#6abf6a'
        }
    },

    sunset: {
        label: 'Sunset',
        light: {
            bg: '#fff7ed',
            card: '#ffffff',
            navbar: '#ffedd5',
            text: '#431407',
            subtext: '#c2410c',
            highlight: '#f97316'
        },
        dark: {
            bg: '#2d0e04',
            card: '#431407',
            navbar: '#7c2d12',
            text: '#fff7ed',
            subtext: '#fff7ed',
            highlight: '#fb923c'
        }
    },

    indigo: {
        label: 'Indigo',
        light: {
            bg: '#eef2ff',
            card: '#ffffff',
            navbar: '#e0e7ff',
            text: '#1e1b4b',
            subtext: '#3730a3',
            highlight: '#6366f1'
        },
        dark: {
            bg: '#1e1b4b',
            card: '#312e81',
            navbar: '#1e1b4b',
            text: '#eef2ff',
            subtext: '#eef2ff',
            highlight: '#818cf8'
        }
    },

    midnight: {
        label: 'Midnight',
        light: {
            bg: '#f0f4ff',
            card: '#ffffff',
            navbar: '#dde5ff',
            text: '#0d0d2b',
            subtext: '#1a1a5e',
            highlight: '#4f46e5'
        },
        dark: {
            bg: '#050510',
            card: '#0d0d2b',
            navbar: '#07071a',
            text: '#e8eaff',
            subtext: '#e8eaff',
            highlight: '#7c73f5'
        }
    },

    sand: {
        label: 'Sand',
        light: {
            bg: '#fdf8f0',
            card: '#ffffff',
            navbar: '#f5ece0',
            text: '#3b2a1a',
            subtext: '#7a5c3a',
            highlight: '#c49a5a'
        },
        dark: {
            bg: '#231a10',
            card: '#3b2a1a',
            navbar: '#1a1008',
            text: '#fdf8f0',
            subtext: '#fdf8f0',
            highlight: '#d4aa6a'
        }
    },
};

export = PRESETS;