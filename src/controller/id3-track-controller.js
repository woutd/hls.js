/*
 * id3 metadata track controller
*/

import Event from '../events';
import EventHandler from '../event-handler';
import ID3 from '../demux/id3';
import { logger } from '../utils/logger';
import { sendAddTrackEvent, clearCurrentCues, getClosestCue } from '../utils/texttrack-utils';

class ID3TrackController extends EventHandler {
  constructor (hls) {
    super(hls,
      Event.MEDIA_ATTACHED,
      Event.MEDIA_DETACHING,
      Event.FRAG_PARSING_METADATA,
      Event.LIVE_BACK_BUFFER_REACHED
    );
    this.id3Track = undefined;
    this.media = undefined;
  }

  destroy () {
    EventHandler.prototype.destroy.call(this);
  }

  // Add ID3 metatadata text track.
  onMediaAttached (data) {
    this.media = data.media;
    if (!this.media) {

    }
  }

  onMediaDetaching () {
    clearCurrentCues(this.id3Track);
    this.id3Track = undefined;
    this.media = undefined;
  }

  getID3Track (textTracks) {
    for (let i = 0; i < textTracks.length; i++) {
      let textTrack = textTracks[i];
      if (textTrack.kind === 'metadata' && textTrack.label === 'id3') {
        // send 'addtrack' when reusing the textTrack for metadata,
        // same as what we do for captions
        sendAddTrackEvent(textTrack, this.media);

        return textTrack;
      }
    }
    return this.media.addTextTrack('metadata', 'id3');
  }

  onFragParsingMetadata (data) {
    const fragment = data.frag;
    const samples = data.samples;

    // create track dynamically
    if (!this.id3Track) {
      this.id3Track = this.getID3Track(this.media.textTracks);
      this.id3Track.mode = 'hidden';
    }

    // Attempt to recreate Safari functionality by creating
    // WebKitDataCue objects when available and store the decoded
    // ID3 data in the value property of the cue
    let Cue = window.WebKitDataCue || window.VTTCue || window.TextTrackCue;

    for (let i = 0; i < samples.length; i++) {
      const frames = ID3.getID3Frames(samples[i].data);
      if (frames) {
        const startTime = samples[i].pts;
        let endTime = i < samples.length - 1 ? samples[i + 1].pts : fragment.endPTS;

        if (startTime === endTime) {
          // Give a slight bump to the endTime if it's equal to startTime to avoid a SyntaxError in IE
          endTime += 0.0001;
        } else if (startTime > endTime) {
          logger.warn('detected an id3 sample with endTime < startTime, adjusting endTime to (startTime + 0.25)');
          endTime = startTime + 0.25;
        }

        for (let j = 0; j < frames.length; j++) {
          const frame = frames[j];
          // Safari doesn't put the timestamp frame in the TextTrack
          if (!ID3.isTimeStampFrame(frame)) {
            const cue = new Cue(startTime, endTime, '');
            cue.value = frame;
            this.id3Track.addCue(cue);
          }
        }
      }
    }
  }

  onLiveBackBufferReached ({ bufferEnd }) {
    if (!this.id3Track || !this.id3Track.cues || !this.id3Track.cues.length) {
      return;
    }
    const foundCue = getClosestCue(this.id3Track.cues, bufferEnd);
    if (!foundCue) {
      return;
    }

    let removeCues = true;
    while (removeCues) {
      const cue = this.id3Track.cues[0];
      if (!this.id3Track.cues.length || cue.id === foundCue.id) {
        removeCues = false;
        return;
      }
      this.id3Track.removeCue(cue);
    }
  }
}

export default ID3TrackController;
