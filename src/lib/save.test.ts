/**
 * Saving a photo to the camera roll (#39).
 *
 * WHAT NO LANE HERE CAN PROVE: that a file lands in anybody's camera roll. That is Lane C
 * on the emulator, by hand, and iOS not at all — there is no Mac. These cover the
 * decisions around the call: which permission is asked for, that a refusal is reported as
 * a refusal rather than a failure, that a remote photo is fetched before being handed to
 * the OS, and that our own copy is not left behind.
 */
const mockRequest = jest.fn();
const mockSave = jest.fn();
const mockDownload = jest.fn();
const mockDelete = jest.fn();
let mockDirExists = true;

jest.mock('expo-media-library', () => ({
  requestPermissionsAsync: (...a: unknown[]) => mockRequest(...a),
  saveToLibraryAsync: (...a: unknown[]) => mockSave(...a),
}));

jest.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache' },
  Directory: class {
    exists = mockDirExists;
    create() {}
  },
  File: class {
    uri = 'file:///cache/runit-saves/1.jpg';
    constructor(..._a: unknown[]) {}
    delete() {
      mockDelete();
    }
    // THE PROPERTY is annotated, not the arrow. `mockDownload` is a `jest.fn()` and so
    // implicitly `any`; a static initialiser referencing it infers its own type from
    // itself, which tsc rejects as TS7022. Annotating the return type alone does not
    // break the cycle -- the property has to carry the signature.
    //
    // Caught by the CONTAINER's typecheck, not locally: I ran tsc after writing the
    // implementation and only jest after writing this file.
    static downloadFileAsync: (...a: unknown[]) => Promise<void> = (...a) => mockDownload(...a);
  },
}));

import { savePhotoToLibrary } from './save';

beforeEach(() => {
  jest.clearAllMocks();
  mockDirExists = true;
  mockRequest.mockResolvedValue({ granted: true });
  mockSave.mockResolvedValue(undefined);
  mockDownload.mockResolvedValue(undefined);
});

describe('the permission', () => {
  it('asks for ADD-ONLY access, never the whole camera roll', async () => {
    // RunIt writes and never reads. Asking for more than it needs is the fastest way to be
    // refused by somebody who was willing to say yes.
    await savePhotoToLibrary('file:///tmp/a.jpg');
    expect(mockRequest).toHaveBeenCalledWith(true);
  });

  it('reports a refusal as a REFUSAL, not a failure', async () => {
    // They chose it. Telling them it broke would be a lie about their own decision, and
    // the caller shows a different sentence for each.
    mockRequest.mockResolvedValue({ granted: false });
    expect(await savePhotoToLibrary('file:///tmp/a.jpg')).toBe('denied');
    expect(mockSave).not.toHaveBeenCalled();
  });
});

describe('where the bytes come from', () => {
  it('hands a local photo straight to the OS, with no download', async () => {
    // A guest saving her own photo already has it on disk.
    expect(await savePhotoToLibrary('file:///tmp/mine.jpg')).toBe('saved');
    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockSave).toHaveBeenCalledWith('file:///tmp/mine.jpg');
  });

  it('downloads a signed URL first, because saveToLibraryAsync takes a local path', async () => {
    expect(await savePhotoToLibrary('https://x.test/p.jpg?token=1')).toBe('saved');
    expect(mockDownload).toHaveBeenCalled();
    expect(mockSave).toHaveBeenCalledWith('file:///cache/runit-saves/1.jpg');
  });

  it('deletes OUR copy afterwards, because the camera roll has its own', async () => {
    // Otherwise the cache grows by a full-size photo every time somebody saves one.
    await savePhotoToLibrary('https://x.test/p.jpg?token=1');
    expect(mockDelete).toHaveBeenCalled();
  });

  it('still deletes it when the save fails', async () => {
    mockSave.mockRejectedValue(new Error('no space'));
    expect(await savePhotoToLibrary('https://x.test/p.jpg?token=1')).toBe('failed');
    expect(mockDelete).toHaveBeenCalled();
  });

  it('does not delete anything when nothing was downloaded', async () => {
    await savePhotoToLibrary('file:///tmp/mine.jpg');
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

describe('when it goes wrong', () => {
  it('reports a failed download as failed, and never as denied', async () => {
    mockDownload.mockRejectedValue(new Error('expired'));
    expect(await savePhotoToLibrary('https://x.test/p.jpg?token=1')).toBe('failed');
  });
});
