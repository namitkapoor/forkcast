import type { ReactNode, SVGProps } from "react";

const base = (children: ReactNode) =>
  function Icon(props: SVGProps<SVGSVGElement>) {
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
      >
        {children}
      </svg>
    );
  };

export const IconMenu = base(<path d="M4 7h16M4 12h16M4 17h16" />);
export const IconCursor = base(<path d="M5 3l14 7-6 2-2 6z" />);
export const IconHand = base(
  <path d="M8 13V5.5a1.5 1.5 0 013 0V11m0-1.5v-5a1.5 1.5 0 013 0V11m0-4.5a1.5 1.5 0 013 0V14a7 7 0 01-7 7h-.5a6 6 0 01-4.6-2.2L4 15.5a1.6 1.6 0 012.4-2.1L8 15" />,
);
export const IconPin = base(
  <>
    <path d="M12 21s-6-5.3-6-10a6 6 0 0112 0c0 4.7-6 10-6 10z" />
    <circle cx="12" cy="11" r="2.2" />
  </>,
);
export const IconBranch = base(
  <>
    <circle cx="6" cy="5" r="2" />
    <circle cx="6" cy="19" r="2" />
    <circle cx="18" cy="9" r="2" />
    <path d="M6 7v10M18 11c0 4-6 3-11.5 6.5" />
  </>,
);
export const IconPlay = base(<path d="M7 5l12 7-12 7z" />);
export const IconDownload = base(<path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 20h14" />);
export const IconPlus = base(<path d="M12 5v14M5 12h14" />);
export const IconMinus = base(<path d="M5 12h14" />);
export const IconHelp = base(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.5 2.5 0 014.6 1.3c0 1.7-2.1 2-2.1 3.4M12 17.2v.1" />
  </>,
);
export const IconX = base(<path d="M6 6l12 12M18 6L6 18" />);
export const IconPanel = base(
  <>
    <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
    <path d="M9.5 4.5v15" />
  </>,
);
export const IconChevron = base(<path d="M9 6l6 6-6 6" />);
export const IconFit = base(<path d="M4 9V5a1 1 0 011-1h4M20 9V5a1 1 0 00-1-1h-4M4 15v4a1 1 0 001 1h4M20 15v4a1 1 0 01-1 1h-4" />);
export const IconSpark = base(<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" />);
export const IconAlert = base(
  <>
    <path d="M12 4l9 16H3z" />
    <path d="M12 10v4M12 17v.1" />
  </>,
);
export const IconPerson = base(
  <>
    <circle cx="12" cy="8" r="3.6" />
    <path d="M5 20c.6-3.6 3.4-5.6 7-5.6s6.4 2 7 5.6" />
  </>,
);
export const IconDevice = base(
  <>
    <rect x="6.5" y="3" width="11" height="18" rx="2.5" />
    <path d="M10.5 18h3" />
  </>,
);
export const IconLasso = base(
  <>
    <path d="M7.5 16.5C4.6 15.3 3 13.4 3 11.2 3 7.2 7 4 12 4s9 3.2 9 7.2-4 7.2-9 7.2c-.9 0-1.8-.1-2.6-.3" strokeDasharray="2.2 2.4" />
    <path d="M9 15.5c0 1.5-1 2.5-2.2 2.5S5 19.2 5.6 20.5" />
  </>,
);
export const IconComment = base(<path d="M5 5h14a1 1 0 011 1v10a1 1 0 01-1 1h-8l-4.5 3.5V17H5a1 1 0 01-1-1V6a1 1 0 011-1z" />);
export const IconUndo = base(<path d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11" />);
export const IconRedo = base(<path d="M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 000 11H13" />);
export const IconChat = base(<path d="M4 12a8 8 0 1114.9 4L20 20l-4-1.1A8 8 0 014 12z" />);
export const IconLayers = base(<path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5" />);
export const IconSend = base(<path d="M12 19V5M5.5 11.5L12 5l6.5 6.5" />);
export const IconFlag = base(<path d="M5 21V4m0 0h11l-2 4 2 4H5" />);
export const IconCheck = base(<path d="M5 12.5l4.5 4.5L19 7.5" />);
export const IconText = base(<path d="M5 6h14M12 6v13" />);
export const IconBox = base(<rect x="4" y="5" width="16" height="14" rx="2.5" />);
export const IconRows = base(<path d="M4 6h16M4 12h16M4 18h16" />);
export const IconCols = base(<path d="M6 4v16M12 4v16M18 4v16" />);
export const IconButton = base(
  <>
    <rect x="3" y="7.5" width="18" height="9" rx="4.5" />
    <path d="M9 12h6" />
  </>,
);
export const IconImage = base(
  <>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <path d="M3.5 16l5-5 4 4 3-3 5 5" />
  </>,
);
export const IconInput = base(
  <>
    <rect x="3" y="6.5" width="18" height="11" rx="2.5" />
    <path d="M7 10v4" />
  </>,
);
export const IconStep = base(
  <>
    <rect x="4" y="3.5" width="7" height="17" rx="2" />
    <rect x="13" y="3.5" width="7" height="17" rx="2" />
  </>,
);
