# Attachment context protection

Artemis accepts up to 20 images and 10 documents per message. Image originals are
limited to 10 MiB each, documents to 100 MiB each, and their combined original
size to 200 MiB. The composer checks accumulated selections and the host checks
stored byte sizes again when binding them to a task. IM transport limits remain
subject to the channel and Gateway's existing restrictions.

Originals live under the application's private `attachments` directory. Drafts,
checkpoints and source events carry references. Text already extracted by older
versions can still be imported; such historical attachments cannot reconstruct
formatting that the old version discarded. Forked tasks retain ownership, and
removing one task does not delete another fork's originals.

PDF and Office parsing runs outside the main process, with two concurrent workers
and a 60-second operation deadline. Existing ZIP expansion limits still apply.
Parsing failures retain the original and expose a failure state. No cloud upload,
automatic OCR, vector database, or extra agent loop is involved.

`attachment_list`, `attachment_read` and `attachment_search` use the host broker
and the current task's attachment scope in Plan, Review and Execute. IM scopes
also include the current authorization context. Reads return bounded text,
source locations and continuation offsets. PDF pages can be rendered on demand;
image crops refer to original image coordinates. Original previews in the desktop
are separate from the image copies used by the model.

Prompt images preserve aspect ratio and transparency, do not upscale, and fit
both a 2048-pixel longest side and a 2500-patch (32 by 32 pixels) budget. A header
check rejects images exceeding 100 megapixels before native decoding. All
accepted images remain accessible even when only some fit the next request.

Small document content is injected only when complete and within the available
budget, capped by 8000 estimated tokens and 5% of the model window. Individual
text reads are limited to a conservative 4000-token ceiling. Text estimates use
UTF-8 bytes to avoid undercounting Chinese and dense data; image estimates are
provider-dependent and conservative, not provider-reported usage.

The final model request includes a budget check for system instructions, tools,
history and new content, with output and safety reserves. Replaceable attachment
images can be omitted from the request view while retaining retrieval references.
Ordinary user text is never silently truncated. Pi remains responsible for history
compaction; a request that still exceeds the local budget fails before reaching
the provider. Estimates cannot establish exact provider token usage.

The composer defaults to a single 34-pixel attachment summary, including up to
three thumbnails and an aggregate processing status. Expanding it shows an
ordered list with a 160-pixel scroll limit, original-image previews, individual
removal and a clear-all action. Escape collapses the list or closes a preview.

The desktop CSS guard increases from 371,000 to 374,000 bytes for the attachment
summary, bounded list and native preview dialog. The measured production CSS is
372,904 bytes; all other performance thresholds remain unchanged.
