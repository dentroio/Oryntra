import type { ElementRef, FeedbackMoment } from "@oryntra/core";

type Props = {
  sessionId: string;
  moments: FeedbackMoment[];
};

type CardProps = {
  sessionId: string;
  moment: FeedbackMoment;
};

function subjectElement(moment: FeedbackMoment): ElementRef | undefined {
  return (
    moment.spatial.lockedElement ??
    moment.spatial.lastClickedElement ??
    moment.spatial.elementUnderPointer
  );
}

export function FeedbackEvidenceCard({ sessionId, moment }: CardProps) {
  const element = subjectElement(moment);
  const viewport = moment.spatial.viewport;
  const bbox = element?.boundingBox;
  const screenshotUrl = moment.screenshotId
    ? `/api/sessions/${sessionId}/screenshots/${moment.screenshotId}`
    : null;

  if (!screenshotUrl && !element) return null;

  return (
    <div className="feedback-evidence-card">
      {element ? (
        <div className="element-ref">
          <strong>{element.name || element.text || element.role}</strong>
          <div className="muted">{element.selector}</div>
        </div>
      ) : null}
      {screenshotUrl && bbox ? (
        <div
          className="screenshot-frame"
          style={{ width: 320, height: (320 / viewport.width) * viewport.height }}
        >
          <img src={screenshotUrl} alt="Feedback screenshot" />
          <div
            className="screenshot-highlight"
            style={{
              left: `${(bbox.x / viewport.width) * 100}%`,
              top: `${(bbox.y / viewport.height) * 100}%`,
              width: `${(bbox.width / viewport.width) * 100}%`,
              height: `${(bbox.height / viewport.height) * 100}%`,
            }}
            title={element?.name || element?.selector}
          />
        </div>
      ) : screenshotUrl ? (
        <img
          className="screenshot-plain"
          src={screenshotUrl}
          alt="Feedback screenshot"
        />
      ) : null}
    </div>
  );
}

export function FeedbackEvidence({ sessionId, moments }: Props) {
  if (moments.length === 0) {
    return <p className="muted">Feedback moments appear after you send chat messages.</p>;
  }

  return (
    <div className="feedback-list">
      {moments
        .slice()
        .reverse()
        .map((moment) => {
          const element = subjectElement(moment);
          const viewport = moment.spatial.viewport;
          const bbox = element?.boundingBox;
          const screenshotUrl = moment.screenshotId
            ? `/api/sessions/${sessionId}/screenshots/${moment.screenshotId}`
            : null;

          return (
            <div key={moment.id} className="feedback-card">
              <div className="feedback-header">
                <span className="tag">{moment.modality}</span>
                <span className="muted">
                  {new Date(moment.timestamp).toLocaleTimeString()}
                </span>
              </div>
              {moment.transcript ? (
                <p className="feedback-transcript">{moment.transcript}</p>
              ) : null}
              <div className="muted">
                {moment.spatial.route} · mouse {moment.spatial.mouse.x},{" "}
                {moment.spatial.mouse.y}
              </div>
              {element ? (
                <div className="element-ref">
                  <strong>{element.name || element.text || element.role}</strong>
                  <div className="muted">{element.selector}</div>
                </div>
              ) : null}
              {screenshotUrl && bbox ? (
                <div
                  className="screenshot-frame"
                  style={{ width: 320, height: (320 / viewport.width) * viewport.height }}
                >
                  <img src={screenshotUrl} alt="Feedback screenshot" />
                  <div
                    className="screenshot-highlight"
                    style={{
                      left: `${(bbox.x / viewport.width) * 100}%`,
                      top: `${(bbox.y / viewport.height) * 100}%`,
                      width: `${(bbox.width / viewport.width) * 100}%`,
                      height: `${(bbox.height / viewport.height) * 100}%`,
                    }}
                    title={element?.name || element?.selector}
                  />
                </div>
              ) : screenshotUrl ? (
                <img
                  className="screenshot-plain"
                  src={screenshotUrl}
                  alt="Feedback screenshot"
                />
              ) : null}
            </div>
          );
        })}
    </div>
  );
}
