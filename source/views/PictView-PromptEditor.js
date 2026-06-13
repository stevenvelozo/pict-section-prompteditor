'use strict';

const libPictView = require('pict-view');
const libPictSectionContent = require('pict-section-content');
const libPictSectionModal = require('pict-section-modal');
const libPictSectionPicker = require('pict-section-picker');
const libMarkdownEditor = require('pict-section-markdowneditor');

const libProvider = require('../providers/PromptProvider-Base.js');
const libTypes = require('../types/PromptEditor-DefaultTypes.js');
const libCompiler = require('../compiler/PromptCompiler.js');
const libZip = require('../zip/PromptZip.js');
const libWordListTemplate = require('../templates/Pict-Template-WordListEntry.js');

/**
 * pict-section-prompteditor -- craft, curate, generate.
 *
 * One section, three surfaces:
 *
 *   Prompts     a list of crafted prompts and an editor: title, prompt type,
 *               one markdown segment per type segment (fixed preambles render
 *               locked), template expression insertion, per-segment preview,
 *               a full pict-section-markdowneditor in a modal for rich edits,
 *               and a generate bar.
 *
 *   Word lists  the matrices behind {~WordListEntry:Name~}: words with
 *               weights (default 1), live percentage per entry.
 *
 *   Generated   every generation, rendered and browsable, downloadable as a
 *               zip of markdown files.
 *
 * State lives behind a PromptDataProvider; the default is in-memory in
 * AppData, keyed per instance, so the section works with no server and
 * multiple sections coexist on one page.
 */

const _DefaultConfiguration =
{
	ViewIdentifier: 'PromptEditor',

	DefaultRenderable: 'PromptEditor-Section',
	DefaultDestinationAddress: '#PromptEditor-Container',

	AutoRender: false,

	// ---- options a host overrides -------------------------------------------
	// The data seam; null means the in-memory default (AppData-backed).
	DataProvider: null,
	// The prompt type set; null means DefaultPromptTypes. Pass your own array
	// to replace the built-ins outright.
	PromptTypes: null,
	// Stamped onto prompts and generated output the user creates.
	CurrentUser: { Key: '', Name: 'Anonymous' },
	// Render-only: no creation, editing, generation, or deletion.
	ReadOnly: false,
	// The random source for weighted draws; null means Math.random.
	RandomFunction: null,
	// CodeMirror 6 modules for the rich editor modal; null falls back to
	// window.CodeMirrorModules; absent entirely hides the rich edit button.
	CodeMirrorModules: null,

	// Compile shape.
	IncludeTitleHeading: true,
	SegmentHeadingLevel: 2,

	// Generation + download.
	GenerateDefaultCount: 5,
	GenerateMaxCount: 100,
	ZipFileName: 'prompts.zip',

	Title: 'Prompt Editor',

	// Event hooks (all optional): a host wires these to autosave, audit,
	// ratings, collaboration -- whatever sits on top.
	onPromptSaved: null,
	onPromptDeleted: null,
	onWordListSaved: null,
	onWordListDeleted: null,
	onGenerated: null,
	onChange: null,

	CSSPriority: 500,
	CSS: /*css*/`
		.pspe { font-size: 14px; color: var(--theme-color-text-primary, #1f2430); }
		.pspe-header { display: flex; align-items: center; gap: 14px; margin-bottom: 12px; flex-wrap: wrap; }
		/* Structural titles take the theme's optional display face + treatment.
		   The fallbacks (inherit / none / normal / 650) keep the look unchanged
		   for hosts whose theme does not define a display family. A host whose
		   brand carries one (e.g. a drafting/engraving face) gets it here with
		   no app-side override. */
		.pspe-title { font-size: 16px; margin-right: auto;
			font-family: var(--theme-typography-family-display, inherit);
			text-transform: var(--theme-typography-display-transform, none);
			letter-spacing: var(--theme-typography-display-tracking, normal);
			font-weight: var(--theme-typography-display-weight, 650); }
		.pspe-tabs { display: flex; gap: 4px; }
		.pspe-tab {
			font: inherit; font-size: 13px; padding: 6px 12px; cursor: pointer;
			border: 1px solid var(--theme-color-border-default, #d6dde3);
			background: var(--theme-color-background-panel, #fff);
			color: var(--theme-color-text-secondary, #5b6470); border-radius: 8px;
			font-family: var(--theme-typography-family-display, inherit);
			text-transform: var(--theme-typography-display-transform, none);
			letter-spacing: var(--theme-typography-display-tracking, normal);
		}
		.pspe-tab-on { background: var(--theme-color-brand-primary, #2880a6); border-color: var(--theme-color-brand-primary, #2880a6); color: var(--theme-color-text-on-brand, #fff); }
		.pspe-tab-count { opacity: 0.75; font-size: 11px; margin-left: 4px; }

		.pspe-btn {
			font: inherit; font-size: 13px; padding: 6px 12px; cursor: pointer; border-radius: 8px;
			border: 1px solid var(--theme-color-border-default, #d6dde3);
			background: var(--theme-color-background-panel, #fff);
			color: var(--theme-color-text-primary, #1f2430);
		}
		.pspe-btn:hover { background: var(--theme-color-background-hover, #eef2f6); }
		.pspe-btn-primary { background: var(--theme-color-brand-primary, #2880a6); border-color: var(--theme-color-brand-primary, #2880a6); color: var(--theme-color-text-on-brand, #fff); }
		.pspe-btn-primary:hover { filter: brightness(0.95); background: var(--theme-color-brand-primary, #2880a6); }
		.pspe-btn-danger { color: var(--theme-color-status-error, #c0392b); }
		.pspe-btn-sm { font-size: 12px; padding: 3px 9px; }

		.pspe-split { display: flex; gap: 10px; align-items: flex-start; }
		/* Width is owned by the pict-section-modal panel handle (resizable,
		   collapsible, persisted); flex-basis auto lets the inline width rule. */
		.pspe-rail { flex: 0 0 auto; min-width: 0; display: flex; flex-direction: column; gap: 8px; box-sizing: border-box; }
		/* The panel's edge (resize strip + collapse tab) is a zero-width flex
		   sibling whose children span its height; align-items: flex-start above
		   would collapse it to zero height and leave nothing to grab. */
		.pspe-split > .pict-panel-edge { align-self: stretch; }
		.pspe-main { flex: 1; min-width: 0; }
		.pspe-rail-list { display: flex; flex-direction: column; gap: 4px; }
		.pspe-rail-item {
			text-align: left; font: inherit; font-size: 13px; cursor: pointer; padding: 8px 10px;
			border: 1px solid var(--theme-color-border-light, #e7ecf0); border-radius: 8px;
			background: var(--theme-color-background-panel, #fff); color: inherit;
		}
		.pspe-rail-item:hover { border-color: var(--theme-color-border-default, #d6dde3); }
		.pspe-rail-item-on { border-color: var(--theme-color-brand-primary, #2880a6); box-shadow: 0 0 0 1px var(--theme-color-brand-primary, #2880a6) inset; }
		.pspe-rail-item-name { font-weight: 600; display: block; }
		.pspe-rail-item-sub { font-size: 11.5px; color: var(--theme-color-text-muted, #97a1ab); display: block; margin-top: 1px; }
		.pspe-empty { color: var(--theme-color-text-muted, #97a1ab); font-size: 13px; padding: 14px 4px; }

		.pspe-input, .pspe-select {
			font: inherit; font-size: 13px; padding: 7px 9px; box-sizing: border-box;
			border: 1px solid var(--theme-color-border-default, #d6dde3); border-radius: 7px;
			background: var(--theme-color-background-panel, #fff); color: inherit;
		}
		.pspe-input:focus, .pspe-select:focus, .pspe-textarea:focus { outline: none; border-color: var(--theme-color-brand-primary, #2880a6); }
		.pspe-editor-head { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
		.pspe-editor-title { flex: 1; min-width: 200px; font-weight: 650; font-size: 15px; }
		.pspe-type-desc { font-size: 12px; color: var(--theme-color-text-muted, #97a1ab); margin: -6px 0 12px; }
		.pspe-editor-opts { margin: -4px 0 12px; }
		.pspe-editor-opt { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--theme-color-text-muted, #97a1ab); cursor: pointer; user-select: none; }

		.pspe-segment {
			border: 1px solid var(--theme-color-border-light, #e7ecf0); border-radius: 10px;
			background: var(--theme-color-background-panel, #fff); padding: 12px 14px; margin-bottom: 10px;
		}
		.pspe-segment-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
		.pspe-segment-name { font-size: 13.5px;
			font-family: var(--theme-typography-family-display, inherit);
			text-transform: var(--theme-typography-display-transform, none);
			letter-spacing: var(--theme-typography-display-tracking, normal);
			font-weight: var(--theme-typography-display-weight, 650); }
		.pspe-segment-guidance { font-size: 12px; color: var(--theme-color-text-muted, #97a1ab); margin-right: auto; }
		.pspe-pill {
			font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; padding: 1px 8px; border-radius: 999px;
			background: var(--theme-color-background-tertiary, #eef2f6); color: var(--theme-color-text-secondary, #5b6470);
		}
		.pspe-textarea {
			width: 100%; box-sizing: border-box; min-height: 84px; resize: vertical; font-size: 13px;
			font-family: var(--theme-typography-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
			padding: 8px 10px; border: 1px solid var(--theme-color-border-default, #d6dde3); border-radius: 7px;
			background: var(--theme-color-background-panel, #fff); color: inherit; line-height: 1.5;
		}
		.pspe-segment-tools { display: flex; gap: 8px; align-items: center; margin-top: 6px; flex-wrap: wrap; }
		.pspe-insert-picker { min-width: 190px; font-size: 12px; }
		.pspe-segment-preview { border: 1px dashed var(--theme-color-border-light, #e7ecf0); border-radius: 7px; padding: 4px 12px; margin-top: 8px; }
		.pspe-fixed-body { border-left: 3px solid var(--theme-color-border-default, #d6dde3); padding: 2px 12px; color: var(--theme-color-text-secondary, #5b6470); }
		.pspe-md p:first-child { margin-top: 6px; } .pspe-md p:last-child { margin-bottom: 6px; }
		.pspe-md pre { background: var(--theme-color-background-secondary, #f7f9fb); padding: 8px 10px; border-radius: 6px; overflow-x: auto; }

		.pspe-generate {
			display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 14px; padding: 11px 14px;
			border: 1px solid var(--theme-color-border-light, #e7ecf0); border-radius: 10px;
			background: var(--theme-color-background-secondary, #f7f9fb);
		}
		.pspe-generate-count { width: 70px; }
		.pspe-generate-note { font-size: 12px; color: var(--theme-color-text-muted, #97a1ab); margin-left: auto; }
		.pspe-preview-panel { margin-top: 12px; }
		.pspe-preview-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
		.pspe-preview-title { font-size: 13.5px;
			font-family: var(--theme-typography-family-display, inherit);
			text-transform: var(--theme-typography-display-transform, none);
			letter-spacing: var(--theme-typography-display-tracking, normal);
			font-weight: var(--theme-typography-display-weight, 650); }
		.pspe-preview-note { font-size: 12px; color: var(--theme-color-text-muted, #97a1ab); margin-right: auto; }
		.pspe-btn-on, .pspe-btn-on:hover { background: var(--theme-color-brand-primary, #2880a6); border-color: var(--theme-color-brand-primary, #2880a6); color: var(--theme-color-text-on-brand, #fff); }
		.pspe-preview-raw {
			margin: 0; padding: 12px 16px; white-space: pre-wrap; word-break: break-word; font-size: 12.5px; line-height: 1.55;
			font-family: var(--theme-typography-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
		}

		.pspe-entry-table { width: 100%; border-collapse: collapse; }
		.pspe-entry-table th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--theme-color-text-muted, #97a1ab); padding: 4px 6px; }
		.pspe-entry-table td { padding: 3px 6px; }
		.pspe-entry-word { width: 100%; }
		.pspe-entry-weight { width: 70px; }
		.pspe-entry-pct { font-size: 12px; color: var(--theme-color-text-secondary, #5b6470); white-space: nowrap; font-variant-numeric: tabular-nums; }

		.pspe-gen-toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; flex-wrap: wrap; }
		.pspe-gen-note { font-size: 12.5px; color: var(--theme-color-text-secondary, #5b6470); margin-right: auto; }
		.pspe-viewer {
			border: 1px solid var(--theme-color-border-light, #e7ecf0); border-radius: 10px;
			background: var(--theme-color-background-panel, #fff); padding: 6px 16px;
		}
		.pspe-viewer-tools { display: flex; gap: 8px; justify-content: flex-end; padding: 8px 0 2px; }

		.pspe-rich-host { min-height: 320px; }
	`,

	Templates:
	[
		{
			Hash: 'PromptEditor-Section',
			Template: /*html*/`
<div class="pspe">
	<div class="pspe-header">
		<div class="pspe-title">{~D:AppData.PromptEditorActive.Title~}</div>
		{~TS:PromptEditor-Tab:AppData.PromptEditorActive.Tabs~}
	</div>
	{~TS:PromptEditor-PromptsPane:AppData.PromptEditorActive.PromptsPaneSlot~}
	{~TS:PromptEditor-WordListsPane:AppData.PromptEditorActive.WordListsPaneSlot~}
	{~TS:PromptEditor-GeneratedPane:AppData.PromptEditorActive.GeneratedPaneSlot~}
</div>`
		},
		{ Hash: 'PromptEditor-Tab', Template: /*html*/`<button class="pspe-tab {~D:Record.OnClass~}" onclick="_Pict.views['{~D:Record.ViewHash~}'].selectTab('{~D:Record.Key~}')">{~D:Record.Label~}<span class="pspe-tab-count">{~D:Record.Count~}</span></button>` },

		// ---- prompts pane ----------------------------------------------------
		{
			Hash: 'PromptEditor-PromptsPane',
			Template: /*html*/`
<div class="pspe-split">
	<div class="pspe-rail" id="pspe-rail-{~D:Record.ViewHash~}-prompts">
		{~TS:PromptEditor-NewPromptButton:Record.NewSlot~}
		<div class="pspe-rail-list">
			{~TS:PromptEditor-PromptListItem:Record.Prompts~}
		</div>
		{~TS:PromptEditor-EmptyNote:Record.EmptySlot~}
	</div>
	<div class="pspe-main">
		{~TS:PromptEditor-PromptEditorPanel:Record.EditorSlot~}
		{~TS:PromptEditor-EmptyNote:Record.NoSelectionSlot~}
	</div>
</div>`
		},
		{ Hash: 'PromptEditor-NewPromptButton', Template: /*html*/`<button class="pspe-btn pspe-btn-primary" onclick="_Pict.views['{~D:Record.ViewHash~}'].newPrompt()">+ New prompt</button>` },
		{ Hash: 'PromptEditor-EmptyNote', Template: /*html*/`<div class="pspe-empty">{~D:Record.Text~}</div>` },
		{
			Hash: 'PromptEditor-PromptListItem',
			Template: /*html*/`
<button class="pspe-rail-item {~D:Record.OnClass~}" onclick="_Pict.views['{~D:Record.ViewHash~}'].selectPrompt('{~D:Record.Key~}')">
	<span class="pspe-rail-item-name" id="pspe-prname-{~D:Record.ViewHash~}-{~D:Record.Key~}">{~D:Record.Title~}</span>
	<span class="pspe-rail-item-sub">{~D:Record.TypeName~}</span>
</button>`
		},
		{
			Hash: 'PromptEditor-PromptEditorPanel',
			Template: /*html*/`
<div class="pspe-editor-head">
	<input class="pspe-input pspe-editor-title" value="{~D:Record.Title~}" placeholder="Prompt title"
		oninput="_Pict.views['{~D:Record.ViewHash~}'].cachePromptTitle(this.value)"
		onchange="_Pict.views['{~D:Record.ViewHash~}'].savePromptTitle()">
	<select class="pspe-select" onchange="_Pict.views['{~D:Record.ViewHash~}'].setPromptType(this.value)">
		{~TS:PromptEditor-TypeOption:Record.TypeOptions~}
	</select>
	{~TS:PromptEditor-PromptActions:Record.ActionsSlot~}
</div>
<div class="pspe-type-desc">{~D:Record.TypeDescription~}</div>
{~TS:PromptEditor-EditorOptions:Record.OptionsSlot~}
{~TS:PromptEditor-Segment:Record.Segments~}
{~TS:PromptEditor-GenerateBar:Record.GenerateSlot~}
{~TS:PromptEditor-PreviewPanel:Record.PreviewPanelSlot~}`
		},
		{
			Hash: 'PromptEditor-PreviewPanel',
			Template: /*html*/`
<div class="pspe-preview-panel">
	<div class="pspe-preview-head">
		<span class="pspe-preview-title">Preview roll</span>
		<span class="pspe-preview-note">one unsaved generation</span>
		<button class="pspe-btn pspe-btn-sm{~D:Record.FormattedOnClass~}" onclick="_Pict.views['{~D:Record.ViewHash~}'].setPreviewMode('rendered')">Formatted</button>
		<button class="pspe-btn pspe-btn-sm{~D:Record.RawOnClass~}" onclick="_Pict.views['{~D:Record.ViewHash~}'].setPreviewMode('raw')">Markdown</button>
		<button class="pspe-btn pspe-btn-sm" onclick="_Pict.views['{~D:Record.ViewHash~}'].copyPreview()">Copy</button>
		<button class="pspe-btn pspe-btn-sm" onclick="_Pict.views['{~D:Record.ViewHash~}'].previewOnce()">Reroll</button>
		<button class="pspe-btn pspe-btn-sm" onclick="_Pict.views['{~D:Record.ViewHash~}'].closePreview()">Close</button>
	</div>
	{~TS:PromptEditor-PreviewRendered:Record.RenderedSlot~}
	{~TS:PromptEditor-PreviewRaw:Record.RawSlot~}
</div>`
		},
		{ Hash: 'PromptEditor-PreviewRendered', Template: /*html*/`<div class="pspe-viewer pspe-md">{~D:Record.MarkdownHtml~}</div>` },
		{ Hash: 'PromptEditor-PreviewRaw', Template: /*html*/`<pre class="pspe-viewer pspe-preview-raw">{~D:Record.MarkdownEscaped~}</pre>` },
		{ Hash: 'PromptEditor-TypeOption', Template: /*html*/`<option value="{~D:Record.Value~}" {~D:Record.SelectedAttr~}>{~D:Record.Label~}</option>` },
		{
			Hash: 'PromptEditor-PromptActions',
			Template: /*html*/`<button class="pspe-btn pspe-btn-sm" title="Duplicate this prompt" onclick="_Pict.views['{~D:Record.ViewHash~}'].duplicatePrompt()">Duplicate</button><button class="pspe-btn pspe-btn-sm pspe-btn-danger" onclick="_Pict.views['{~D:Record.ViewHash~}'].deletePrompt()">Delete</button>`
		},
		{
			Hash: 'PromptEditor-EditorOptions',
			Template: /*html*/`
<div class="pspe-editor-opts">
	<label class="pspe-editor-opt" title="When off, the assembled prompt is just the segment bodies, no ## headings above them.">
		<input type="checkbox" {~D:Record.SegmentHeadingsChecked~}
			onchange="_Pict.views['{~D:Record.ViewHash~}'].setSegmentHeadings(this.checked)">
		Segment headings in the output
	</label>
</div>`
		},
		{
			Hash: 'PromptEditor-Segment',
			Template: /*html*/`
<div class="pspe-segment">
	<div class="pspe-segment-head">
		<span class="pspe-segment-name">{~D:Record.Name~}</span>
		<span class="pspe-segment-guidance">{~D:Record.Guidance~}</span>
		{~TS:PromptEditor-SegmentPill:Record.PillSlot~}
	</div>
	{~TS:PromptEditor-SegmentFixed:Record.FixedSlot~}
	{~TS:PromptEditor-SegmentEdit:Record.EditSlot~}
	{~TS:PromptEditor-SegmentPreview:Record.PreviewSlot~}
</div>`
		},
		{ Hash: 'PromptEditor-SegmentPill', Template: /*html*/`<span class="pspe-pill">{~D:Record.Label~}</span>` },
		{ Hash: 'PromptEditor-SegmentFixed', Template: /*html*/`<div class="pspe-fixed-body pspe-md">{~D:Record.BodyHtml~}</div>` },
		{
			Hash: 'PromptEditor-SegmentEdit',
			Template: /*html*/`
<textarea class="pspe-textarea" id="{~D:Record.TextareaId~}" placeholder="{~D:Record.Placeholder~}"
	oninput="_Pict.views['{~D:Record.ViewHash~}'].cacheSegment('{~D:Record.SegmentKey~}', this.value)"
	onchange="_Pict.views['{~D:Record.ViewHash~}'].saveSegment('{~D:Record.SegmentKey~}')">{~D:Record.Body~}</textarea>
<div class="pspe-segment-tools">
	<div class="pspe-insert-picker" id="pspe-ins-{~D:Record.ViewHash~}-{~D:Record.SegmentKey~}"></div>
	<button class="pspe-btn pspe-btn-sm" onclick="_Pict.views['{~D:Record.ViewHash~}'].toggleSegmentPreview('{~D:Record.SegmentKey~}')">{~D:Record.PreviewLabel~}</button>
	{~TS:PromptEditor-SegmentRichButton:Record.RichSlot~}
</div>`
		},
		{ Hash: 'PromptEditor-SegmentRichButton', Template: /*html*/`<button class="pspe-btn pspe-btn-sm" onclick="_Pict.views['{~D:Record.ViewHash~}'].openRichEditor('{~D:Record.SegmentKey~}')">Open in editor</button>` },
		{ Hash: 'PromptEditor-SegmentPreview', Template: /*html*/`<div class="pspe-segment-preview pspe-md">{~D:Record.BodyHtml~}</div>` },
		{
			Hash: 'PromptEditor-GenerateBar',
			Template: /*html*/`
<div class="pspe-generate">
	<input type="number" min="1" max="{~D:Record.MaxCount~}" class="pspe-input pspe-generate-count" value="{~D:Record.Count~}"
		onchange="_Pict.views['{~D:Record.ViewHash~}'].setGenerateCount(this.value)">
	<button class="pspe-btn pspe-btn-primary" onclick="_Pict.views['{~D:Record.ViewHash~}'].generatePrompts()">Generate</button>
	<button class="pspe-btn" onclick="_Pict.views['{~D:Record.ViewHash~}'].previewOnce()">Preview one</button>
	<span class="pspe-generate-note">{~D:Record.Note~}</span>
</div>`
		},

		// ---- word lists pane -------------------------------------------------
		{
			Hash: 'PromptEditor-WordListsPane',
			Template: /*html*/`
<div class="pspe-split">
	<div class="pspe-rail" id="pspe-rail-{~D:Record.ViewHash~}-wordlists">
		{~TS:PromptEditor-NewWordListButton:Record.NewSlot~}
		<div class="pspe-rail-list">
			{~TS:PromptEditor-WordListItem:Record.WordLists~}
		</div>
		{~TS:PromptEditor-EmptyNote:Record.EmptySlot~}
	</div>
	<div class="pspe-main">
		{~TS:PromptEditor-WordListDetail:Record.DetailSlot~}
		{~TS:PromptEditor-EmptyNote:Record.NoSelectionSlot~}
	</div>
</div>`
		},
		{ Hash: 'PromptEditor-NewWordListButton', Template: /*html*/`<button class="pspe-btn pspe-btn-primary" onclick="_Pict.views['{~D:Record.ViewHash~}'].newWordList()">+ New word list</button>` },
		{
			Hash: 'PromptEditor-WordListItem',
			Template: /*html*/`
<button class="pspe-rail-item {~D:Record.OnClass~}" onclick="_Pict.views['{~D:Record.ViewHash~}'].selectWordList('{~D:Record.Key~}')">
	<span class="pspe-rail-item-name" id="pspe-wlname-{~D:Record.ViewHash~}-{~D:Record.Key~}">{~D:Record.Name~}</span>
	<span class="pspe-rail-item-sub" id="pspe-wlsub-{~D:Record.ViewHash~}-{~D:Record.Key~}">{~D:Record.Summary~}</span>
</button>`
		},
		{
			Hash: 'PromptEditor-WordListDetail',
			Template: /*html*/`
<div class="pspe-editor-head">
	<input class="pspe-input pspe-editor-title" value="{~D:Record.Name~}" placeholder="Word list name"
		oninput="_Pict.views['{~D:Record.ViewHash~}'].cacheWordListName(this.value)"
		onchange="_Pict.views['{~D:Record.ViewHash~}'].saveWordListName()">
	<button class="pspe-btn pspe-btn-sm pspe-btn-danger" onclick="_Pict.views['{~D:Record.ViewHash~}'].deleteWordList()">Delete</button>
</div>
<div class="pspe-type-desc">Reference it in any segment as <code>{~D:Record.ExpressionExample~}</code>. Weights set each word's share of the draws.</div>
<table class="pspe-entry-table">
	<thead><tr><th>Word</th><th>Weight</th><th>Share</th><th></th></tr></thead>
	<tbody>{~TS:PromptEditor-WordListEntryRow:Record.Entries~}</tbody>
</table>
<div class="pspe-segment-tools">
	<button class="pspe-btn pspe-btn-sm" onclick="_Pict.views['{~D:Record.ViewHash~}'].addWordListEntry()">+ Add word</button>
</div>`
		},
		{
			Hash: 'PromptEditor-WordListEntryRow',
			Template: /*html*/`
<tr>
	<td><input class="pspe-input pspe-entry-word" value="{~D:Record.Word~}" placeholder="word or phrase"
		oninput="_Pict.views['{~D:Record.ViewHash~}'].cacheEntryWord({~D:Record.Index~}, this.value)"
		onchange="_Pict.views['{~D:Record.ViewHash~}'].saveEntries()"></td>
	<td><input type="number" min="0" step="1" class="pspe-input pspe-entry-weight" value="{~D:Record.Weight~}"
		oninput="_Pict.views['{~D:Record.ViewHash~}'].cacheEntryWeight({~D:Record.Index~}, this.value)"
		onchange="_Pict.views['{~D:Record.ViewHash~}'].saveEntries()"></td>
	<td class="pspe-entry-pct" id="pspe-pct-{~D:Record.ViewHash~}-{~D:Record.Index~}">{~D:Record.Percent~}</td>
	<td><button class="pspe-btn pspe-btn-sm pspe-btn-danger" title="Remove" onclick="_Pict.views['{~D:Record.ViewHash~}'].removeWordListEntry({~D:Record.Index~})">×</button></td>
</tr>`
		},

		// ---- generated pane ----------------------------------------------------
		{
			Hash: 'PromptEditor-GeneratedPane',
			Template: /*html*/`
<div class="pspe-gen-toolbar">
	<span class="pspe-gen-note">{~D:Record.Note~}</span>
	{~TS:PromptEditor-GeneratedTools:Record.ToolsSlot~}
</div>
<div class="pspe-split">
	<div class="pspe-rail" id="pspe-rail-{~D:Record.ViewHash~}-generated">
		<div class="pspe-rail-list">
			{~TS:PromptEditor-GeneratedRow:Record.Generated~}
		</div>
		{~TS:PromptEditor-EmptyNote:Record.EmptySlot~}
	</div>
	<div class="pspe-main">
		{~TS:PromptEditor-GeneratedViewer:Record.ViewerSlot~}
		{~TS:PromptEditor-EmptyNote:Record.NoSelectionSlot~}
	</div>
</div>`
		},
		{
			Hash: 'PromptEditor-GeneratedTools',
			Template: /*html*/`<button class="pspe-btn pspe-btn-primary" onclick="_Pict.views['{~D:Record.ViewHash~}'].downloadZip()">Download zip</button><button class="pspe-btn pspe-btn-danger" onclick="_Pict.views['{~D:Record.ViewHash~}'].clearGenerated()">Clear all</button>`
		},
		{
			Hash: 'PromptEditor-GeneratedRow',
			Template: /*html*/`
<button class="pspe-rail-item {~D:Record.OnClass~}" onclick="_Pict.views['{~D:Record.ViewHash~}'].selectGenerated('{~D:Record.Key~}')">
	<span class="pspe-rail-item-name">{~D:Record.FileName~}</span>
	<span class="pspe-rail-item-sub">{~D:Record.Sub~}</span>
</button>`
		},
		{
			Hash: 'PromptEditor-GeneratedViewer',
			Template: /*html*/`
<div class="pspe-viewer-tools">
	<button class="pspe-btn pspe-btn-sm" onclick="_Pict.views['{~D:Record.ViewHash~}'].copyGenerated()">Copy markdown</button>
	<button class="pspe-btn pspe-btn-sm pspe-btn-danger" onclick="_Pict.views['{~D:Record.ViewHash~}'].deleteGenerated()">Delete</button>
</div>
<div class="pspe-viewer pspe-md">{~D:Record.MarkdownHtml~}</div>`
		}
	],

	Renderables:
	[
		{
			RenderableHash: 'PromptEditor-Section',
			TemplateHash: 'PromptEditor-Section',
			ContentDestinationAddress: '#PromptEditor-Container',
			RenderMethod: 'replace'
		}
	]
};

class PictViewPromptEditor extends libPictView
{
	constructor(pFable, pOptions, pServiceHash)
	{
		let tmpOptions = Object.assign({}, JSON.parse(JSON.stringify(_DefaultConfiguration)), pOptions);
		// Function options do not survive the JSON clone of defaults; restore.
		['DataProvider', 'PromptTypes', 'RandomFunction', 'CodeMirrorModules',
			'onPromptSaved', 'onPromptDeleted', 'onWordListSaved', 'onWordListDeleted', 'onGenerated', 'onChange']
			.forEach((pKey) => { if (pOptions && typeof pOptions[pKey] !== 'undefined') { tmpOptions[pKey] = pOptions[pKey]; } });
		super(pFable, tmpOptions, pServiceHash);

		this._provider = null;
		this._types = libTypes.resolvePromptTypes(this.options.PromptTypes);
		this._loaded = { WordLists: [], Prompts: [], Generated: [] };
		this._ui =
		{
			Tab: 'prompts',
			ActivePromptKey: null,
			ActiveWordListKey: null,
			ActiveGeneratedKey: null,
			GenerateCount: this.options.GenerateDefaultCount,
			PreviewSegments: {},
			Preview: null,
			PreviewMode: 'rendered'
		};
		this._state = {};
		this._richEditorViewHash = null;
		this._entriesSaveTimer = null;
		this._railPanelHandle = null;
	}

	// ---- lifecycle -----------------------------------------------------------
	onBeforeInitialize()
	{
		this._initProvider();
		this._ensureSupportViews();
		this._registerTemplateExpression();
		return super.onBeforeInitialize();
	}

	onAfterInitializeAsync(fCallback)
	{
		this.load().then(() => fCallback()).catch(() => { this._shape(); this.render(); fCallback(); });
	}

	onBeforeRender(pRenderable)
	{
		this.pict.AppData.PromptEditorActive = this._state;
		return super.onBeforeRender(pRenderable);
	}

	onAfterRender(pRenderable, pAddress, pRecord, pContent)
	{
		this._mountInsertPickers();
		this._mountRailPanel();
		if (this.pict.CSSMap) { this.pict.CSSMap.injectCSS(); }
		return super.onAfterRender(pRenderable, pAddress, pRecord, pContent);
	}

	// The list rail is a pict-section-modal panel: draggable resize handle,
	// collapse tab, width and collapsed state persisted per section. One
	// persist key covers all three tabs so the rail feels like one control.
	// Re-attached after every render (the render replaces the rail's DOM).
	_mountRailPanel()
	{
		let tmpModal = this._modal();
		if (!tmpModal || typeof tmpModal.panel !== 'function' || typeof document === 'undefined') { return; }
		let tmpRailId = 'pspe-rail-' + this.Hash + '-' + this._ui.Tab;
		if (!document.getElementById(tmpRailId)) { return; }
		if (this._railPanelHandle)
		{
			try { this._railPanelHandle.destroy(); }
			catch (pError) { /* the prior rail's DOM is already gone */ }
			this._railPanelHandle = null;
		}
		this._railPanelHandle = tmpModal.panel('#' + tmpRailId,
		{
			position: 'left',
			width: 320,
			minWidth: 200,
			maxWidth: 560,
			collapsible: true,
			persist: true,
			persistKey: 'pspe-rail-' + this.Hash
		});
	}

	// One searchable picker (pict-section-picker) per editable segment, rendered
	// into the host div the segment template provides. createPicker is
	// re-entrant -- it merges config into an existing view -- so every section
	// render refreshes the option list and the OnChange closure, then repaints.
	_mountInsertPickers()
	{
		let tmpPickerProvider = this.pict.providers['Pict-Section-Picker'];
		if (!tmpPickerProvider || typeof document === 'undefined') { return; }
		if (this._ui.Tab !== 'prompts' || this.options.ReadOnly) { return; }
		let tmpPrompt = this._activePrompt();
		if (!tmpPrompt) { return; }
		if (!this.pict.AppData.PromptEditorInsertPick) { this.pict.AppData.PromptEditorInsertPick = {}; }
		let tmpType = libTypes.getPromptType(this._types, tmpPrompt.TypeKey);
		let tmpOptions = this._loaded.WordLists.map((pList) => ({ Value: pList.Name, Text: pList.Name }));
		let tmpSelf = this;
		(tmpType.Segments || []).forEach((pSegment) =>
		{
			if (pSegment.Fixed) { return; }
			let tmpHostId = 'pspe-ins-' + this.Hash + '-' + pSegment.Key;
			if (!document.getElementById(tmpHostId)) { return; }
			let tmpPickerHash = 'PromptEditor-Ins-' + this.Hash + '-' + pSegment.Key;
			let tmpPickerView = tmpPickerProvider.createPicker(tmpPickerHash,
			{
				DestinationAddress: '#' + tmpHostId,
				ValueAddress: 'AppData.PromptEditorInsertPick.' + tmpPickerHash,
				Placeholder: 'Insert word list…',
				Options: tmpOptions,
				OnChange: (pValue) =>
				{
					if (!pValue) { return; }
					tmpSelf.insertWordList(pSegment.Key, pValue, 'pspe-seg-' + tmpSelf.Hash + '-' + pSegment.Key);
					// This control is an action, not a value holder: reset to the
					// placeholder once the picker finishes its own select cycle.
					setTimeout(() =>
					{
						try { tmpPickerView.setValue(null); }
						catch (pError) { /* the picker was re-rendered away; nothing to reset */ }
					}, 0);
				}
			});
			tmpPickerView.render();
		});
	}

	// ---- wiring --------------------------------------------------------------
	_initProvider()
	{
		if (this.options.DataProvider)
		{
			this._provider = this.options.DataProvider;
			return;
		}
		if (!this.pict.AppData.PromptEditorStores) { this.pict.AppData.PromptEditorStores = {}; }
		if (!this.pict.AppData.PromptEditorStores[this.Hash]) { this.pict.AppData.PromptEditorStores[this.Hash] = {}; }
		this._provider = new libProvider.InMemoryPromptProvider({ Store: this.pict.AppData.PromptEditorStores[this.Hash] });
	}

	_ensureSupportViews()
	{
		// Markdown rendering for previews and the generated browser.
		if (!this._contentProvider())
		{
			this.pict.addProvider('Pict-Content',
				libPictSectionContent.PictContentProvider.default_configuration,
				libPictSectionContent.PictContentProvider);
		}
		// Confirm dialogs, toasts, and the rich editor host. Registering is not
		// enough: the modal scopes its CSS variables under a .pict-modal-root
		// class it puts on <body> during onBeforeInitialize, so an uninitialized
		// modal renders unstyled dialogs and toasts. Initialize it explicitly
		// when the root class is absent (idempotent in hosts that already did).
		if (!this.pict.views['Pict-Section-Modal'])
		{
			this.pict.addView('Pict-Section-Modal', libPictSectionModal.default_configuration, libPictSectionModal);
		}
		let tmpModalView = this.pict.views['Pict-Section-Modal'];
		if (tmpModalView && typeof document !== 'undefined' && document.body
			&& !document.body.classList.contains('pict-modal-root')
			&& typeof tmpModalView.initialize === 'function')
		{
			tmpModalView.initialize();
		}
		// The searchable insert-word-list control on each segment.
		if (!this.pict.providers['Pict-Section-Picker'])
		{
			this.pict.addProvider('Pict-Section-Picker', libPictSectionPicker.default_configuration, libPictSectionPicker);
		}
		// The modal's panel collapse tab resolves its chevron through the
		// window.pict global (the framework convention); expose it for hosts
		// that only set window._Pict, or the tab renders without a glyph.
		if (typeof window !== 'undefined' && !window.pict)
		{
			window.pict = this.pict;
		}
	}

	_registerTemplateExpression()
	{
		// Register {~WordListEntry:~} once per pict instance, then add this
		// view's word lists as a resolver so the expression works in ordinary
		// application templates too (not just generation runs).
		if (!this.pict.__PictSectionPromptEditorTemplateRegistered && typeof this.pict.addTemplate === 'function')
		{
			try { this.pict.addTemplate(libWordListTemplate); this.pict.__PictSectionPromptEditorTemplateRegistered = true; }
			catch (pError) { this.log.warn('PromptEditor: WordListEntry template registration failed: ' + pError.message); }
		}
		if (!Array.isArray(this.pict.__PictSectionPromptEditorResolvers)) { this.pict.__PictSectionPromptEditorResolvers = []; }
		this.pict.__PictSectionPromptEditorResolvers.push((pNameLower) =>
		{
			let tmpList = (this._loaded.WordLists || []).find((pList) => String(pList.Name || '').trim().toLowerCase() === pNameLower);
			return tmpList ? tmpList.Entries : null;
		});
	}

	_contentProvider()
	{
		let tmpCandidates = ['Pict-Content', 'Content'];
		for (let i = 0; i < tmpCandidates.length; i++)
		{
			let tmpProvider = this.pict.providers[tmpCandidates[i]];
			if (tmpProvider && typeof tmpProvider.parseMarkdown === 'function') { return tmpProvider; }
		}
		return null;
	}

	_modal() { return this.pict.views['Pict-Section-Modal']; }

	_toast(pMessage, pType)
	{
		let tmpModal = this._modal();
		if (tmpModal && typeof tmpModal.toast === 'function') { tmpModal.toast(pMessage, { type: pType || 'info' }); }
	}

	_fire(pHook, pPayload)
	{
		if (typeof this.options[pHook] === 'function')
		{
			try { this.options[pHook](pPayload); } catch (pError) { /* a host hook throwing must not break the section */ }
		}
		if (pHook !== 'onChange' && typeof this.options.onChange === 'function')
		{
			try { this.options.onChange({ Event: pHook.replace(/^on/, ''), Payload: pPayload }); } catch (pError) { /* same */ }
		}
	}

	// ---- public API ------------------------------------------------------------
	load()
	{
		return this._provider.loadAll().then((pAll) =>
		{
			this._loaded = pAll;
			// Keep selections honest after a reload.
			if (this._ui.ActivePromptKey && !this._findPrompt(this._ui.ActivePromptKey)) { this._ui.ActivePromptKey = null; }
			if (!this._ui.ActivePromptKey && this._loaded.Prompts.length) { this._ui.ActivePromptKey = this._loaded.Prompts[0].Key; }
			if (this._ui.ActiveWordListKey && !this._findWordList(this._ui.ActiveWordListKey)) { this._ui.ActiveWordListKey = null; }
			if (!this._ui.ActiveWordListKey && this._loaded.WordLists.length) { this._ui.ActiveWordListKey = this._loaded.WordLists[0].Key; }
			if (this._ui.ActiveGeneratedKey && !this._findGenerated(this._ui.ActiveGeneratedKey)) { this._ui.ActiveGeneratedKey = null; }
			if (!this._ui.ActiveGeneratedKey && this._loaded.Generated.length) { this._ui.ActiveGeneratedKey = this._loaded.Generated[0].Key; }
			this._shape();
			this.render();
		});
	}

	refresh() { return this.load(); }

	setReadOnly(pReadOnly)
	{
		this.options.ReadOnly = !!pReadOnly;
		this._shape();
		this.render();
	}

	setDataProvider(pProvider)
	{
		this._provider = pProvider || null;
		if (!this._provider) { this._initProvider(); }
		return this.load();
	}

	// ---- lookups ---------------------------------------------------------------
	_findPrompt(pKey) { return this._loaded.Prompts.find((pPrompt) => pPrompt.Key === pKey) || null; }
	_findWordList(pKey) { return this._loaded.WordLists.find((pList) => pList.Key === pKey) || null; }
	_findGenerated(pKey) { return this._loaded.Generated.find((pGenerated) => pGenerated.Key === pKey) || null; }
	_activePrompt() { return this._findPrompt(this._ui.ActivePromptKey); }
	_activeWordList() { return this._findWordList(this._ui.ActiveWordListKey); }
	_activeType() { let tmpPrompt = this._activePrompt(); return tmpPrompt ? libTypes.getPromptType(this._types, tmpPrompt.TypeKey) : null; }

	_renderMarkdown(pMarkdown)
	{
		let tmpMarkdown = String(pMarkdown || '');
		let tmpProvider = this._contentProvider();
		if (tmpProvider)
		{
			try { return tmpProvider.parseMarkdown(tmpMarkdown, null, null, null) || ''; }
			catch (pError) { /* fall through to the escaped form */ }
		}
		let tmpEscaped = tmpMarkdown.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		return '<pre>' + tmpEscaped + '</pre>';
	}

	_escapeHtml(pText)
	{
		return String(pText == null ? '' : pText).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	_wordListTotal(pList)
	{
		return ((pList && pList.Entries) || []).reduce((pSum, pEntry) =>
		{
			let tmpWeight = Number(pEntry[1]);
			return pSum + ((isFinite(tmpWeight) && tmpWeight > 0) ? tmpWeight : 0);
		}, 0);
	}

	_entryShare(pWeight, pTotal)
	{
		let tmpWeight = Number(pWeight);
		return (pTotal > 0 && isFinite(tmpWeight) && tmpWeight > 0)
			? (Math.round((tmpWeight / pTotal) * 1000) / 10) + '%'
			: '0%';
	}

	// Live update of the share chips and the rail summary after a weight edit,
	// via targeted DOM writes. Deliberately NOT a re-render: replacing the pane
	// would destroy the input mid-interaction (spinner clicks, typing focus).
	_refreshShareCells()
	{
		let tmpList = this._activeWordList();
		if (!tmpList) { return; }
		let tmpEntries = tmpList.Entries || [];
		let tmpTotal = this._wordListTotal(tmpList);
		for (let i = 0; i < tmpEntries.length; i++)
		{
			this.pict.ContentAssignment.assignContent('#pspe-pct-' + this.Hash + '-' + i, this._entryShare(tmpEntries[i][1], tmpTotal));
		}
		this.pict.ContentAssignment.assignContent('#pspe-wlsub-' + this.Hash + '-' + tmpList.Key,
			this._escapeHtml(tmpEntries.length + ' words · total weight ' + tmpTotal));
	}

	_scheduleEntriesSave()
	{
		if (this._entriesSaveTimer) { clearTimeout(this._entriesSaveTimer); }
		this._entriesSaveTimer = setTimeout(() => { this._entriesSaveTimer = null; this.saveEntries(); }, 400);
	}

	_copyToClipboard(pText, pLabel)
	{
		if (typeof navigator === 'undefined' || !navigator.clipboard || !navigator.clipboard.writeText)
		{
			this._toast('Clipboard is not available here.', 'info');
			return;
		}
		navigator.clipboard.writeText(String(pText == null ? '' : pText))
			.then(() => this._toast((pLabel || 'Markdown') + ' copied.', 'success'))
			.catch(() => this._toast('Copy failed.', 'error'));
	}

	_ago(pStamp)
	{
		let tmpDelta = Date.now() - Number(pStamp || 0);
		if (!isFinite(tmpDelta) || tmpDelta < 0) { return ''; }
		let tmpMinutes = Math.floor(tmpDelta / 60000);
		if (tmpMinutes < 1) { return 'just now'; }
		if (tmpMinutes < 60) { return tmpMinutes + 'm ago'; }
		let tmpHours = Math.floor(tmpMinutes / 60);
		if (tmpHours < 24) { return tmpHours + 'h ago'; }
		return Math.floor(tmpHours / 24) + 'd ago';
	}

	// ---- shape: loaded + ui --> the render model -------------------------------
	_shape()
	{
		let tmpReadOnly = !!this.options.ReadOnly;
		let tmpState =
		{
			ViewHash: this.Hash,
			Title: this.options.Title,
			Tabs:
			[
				{ ViewHash: this.Hash, Key: 'prompts', Label: 'Prompts', Count: this._loaded.Prompts.length, OnClass: (this._ui.Tab === 'prompts') ? 'pspe-tab-on' : '' },
				{ ViewHash: this.Hash, Key: 'wordlists', Label: 'Word Lists', Count: this._loaded.WordLists.length, OnClass: (this._ui.Tab === 'wordlists') ? 'pspe-tab-on' : '' },
				{ ViewHash: this.Hash, Key: 'generated', Label: 'Generated', Count: this._loaded.Generated.length, OnClass: (this._ui.Tab === 'generated') ? 'pspe-tab-on' : '' }
			],
			PromptsPaneSlot: [],
			WordListsPaneSlot: [],
			GeneratedPaneSlot: []
		};

		if (this._ui.Tab === 'prompts') { tmpState.PromptsPaneSlot = [this._shapePromptsPane(tmpReadOnly)]; }
		else if (this._ui.Tab === 'wordlists') { tmpState.WordListsPaneSlot = [this._shapeWordListsPane(tmpReadOnly)]; }
		else { tmpState.GeneratedPaneSlot = [this._shapeGeneratedPane(tmpReadOnly)]; }

		this._state = tmpState;
	}

	_shapePromptsPane(pReadOnly)
	{
		let tmpActive = this._activePrompt();
		let tmpPane =
		{
			ViewHash: this.Hash,
			NewSlot: pReadOnly ? [] : [{ ViewHash: this.Hash }],
			Prompts: this._loaded.Prompts.map((pPrompt) => (
			{
				ViewHash: this.Hash,
				Key: pPrompt.Key,
				Title: pPrompt.Title || 'Untitled prompt',
				TypeName: libTypes.getPromptType(this._types, pPrompt.TypeKey).Name + ' · ' + this._ago(pPrompt.UpdatedAt),
				OnClass: (tmpActive && tmpActive.Key === pPrompt.Key) ? 'pspe-rail-item-on' : ''
			})),
			EmptySlot: this._loaded.Prompts.length ? [] : [{ Text: 'No prompts yet.' }],
			EditorSlot: [],
			NoSelectionSlot: []
		};
		if (tmpActive) { tmpPane.EditorSlot = [this._shapePromptEditor(tmpActive, pReadOnly)]; }
		else { tmpPane.NoSelectionSlot = [{ Text: pReadOnly ? 'Nothing to show.' : 'Create a prompt to start crafting.' }]; }
		return tmpPane;
	}

	_shapePromptEditor(pPrompt, pReadOnly)
	{
		let tmpType = libTypes.getPromptType(this._types, pPrompt.TypeKey);
		let tmpHasRichEditor = !pReadOnly && !!(this.options.CodeMirrorModules || (typeof window !== 'undefined' && window.CodeMirrorModules));

		let tmpSegments = (tmpType.Segments || []).map((pSegment) =>
		{
			let tmpBody = String((pPrompt.Segments || {})[pSegment.Key] || '');
			let tmpPreviewKey = pPrompt.Key + ':' + pSegment.Key;
			let tmpPreviewOn = !!this._ui.PreviewSegments[tmpPreviewKey];
			let tmpPills = [];
			if (pSegment.Fixed) { tmpPills.push({ Label: 'fixed' }); }
			if (pSegment.Optional) { tmpPills.push({ Label: 'optional' }); }
			let tmpShaped =
			{
				ViewHash: this.Hash,
				SegmentKey: pSegment.Key,
				Name: pSegment.Name || pSegment.Key,
				Guidance: pSegment.Guidance || '',
				PillSlot: tmpPills,
				FixedSlot: [],
				EditSlot: [],
				PreviewSlot: []
			};
			if (pSegment.Fixed)
			{
				tmpShaped.FixedSlot = [{ BodyHtml: this._renderMarkdown(pSegment.Body || '') }];
				return tmpShaped;
			}
			if (pReadOnly)
			{
				tmpShaped.PreviewSlot = [{ BodyHtml: this._renderMarkdown(tmpBody || '*(empty)*') }];
				return tmpShaped;
			}
			tmpShaped.EditSlot =
			[{
				ViewHash: this.Hash,
				SegmentKey: pSegment.Key,
				TextareaId: 'pspe-seg-' + this.Hash + '-' + pSegment.Key,
				Body: tmpBody,
				Placeholder: 'Markdown. Pict template expressions welcome, like {~WordListEntry:ListName~}.',
				PreviewLabel: tmpPreviewOn ? 'Hide preview' : 'Preview',
				RichSlot: tmpHasRichEditor ? [{ ViewHash: this.Hash, SegmentKey: pSegment.Key }] : []
			}];
			if (tmpPreviewOn)
			{
				tmpShaped.PreviewSlot = [{ BodyHtml: this._renderMarkdown(tmpBody || '*(empty)*') }];
			}
			return tmpShaped;
		});

		let tmpGeneratedForPrompt = this._loaded.Generated.filter((pGenerated) => pGenerated.PromptKey === pPrompt.Key).length;
		return (
		{
			ViewHash: this.Hash,
			Title: pPrompt.Title || '',
			TypeDescription: tmpType.Description || '',
			TypeOptions: this._types.map((pTypeOption) => (
			{
				Value: pTypeOption.Key,
				Label: pTypeOption.Name,
				SelectedAttr: (pTypeOption.Key === pPrompt.TypeKey) ? 'selected' : ''
			})),
			ActionsSlot: pReadOnly ? [] : [{ ViewHash: this.Hash }],
			OptionsSlot: pReadOnly ? [] :
			[{
				ViewHash: this.Hash,
				SegmentHeadingsChecked: (pPrompt.IncludeSegmentHeadings === false) ? '' : 'checked'
			}],
			Segments: tmpSegments,
			GenerateSlot: pReadOnly ? [] :
			[{
				ViewHash: this.Hash,
				Count: this._ui.GenerateCount,
				MaxCount: this.options.GenerateMaxCount,
				Note: tmpGeneratedForPrompt ? (tmpGeneratedForPrompt + ' generated from this prompt so far') : 'Each generation rolls the word lists fresh.'
			}],
			PreviewPanelSlot: (this._ui.Preview && this._ui.Preview.PromptKey === pPrompt.Key)
				? [{
					ViewHash: this.Hash,
					FormattedOnClass: (this._ui.PreviewMode !== 'raw') ? ' pspe-btn-on' : '',
					RawOnClass: (this._ui.PreviewMode === 'raw') ? ' pspe-btn-on' : '',
					RenderedSlot: (this._ui.PreviewMode !== 'raw') ? [{ MarkdownHtml: this._renderMarkdown(this._ui.Preview.Markdown) }] : [],
					RawSlot: (this._ui.PreviewMode === 'raw') ? [{ MarkdownEscaped: this._escapeHtml(this._ui.Preview.Markdown) }] : []
				}]
				: []
		});
	}

	_shapeWordListsPane(pReadOnly)
	{
		let tmpActive = this._activeWordList();
		let tmpPane =
		{
			ViewHash: this.Hash,
			NewSlot: pReadOnly ? [] : [{ ViewHash: this.Hash }],
			WordLists: this._loaded.WordLists.map((pList) => (
			{
				ViewHash: this.Hash,
				Key: pList.Key,
				Name: pList.Name,
				Summary: (pList.Entries || []).length + ' words · total weight ' + this._wordListTotal(pList),
				OnClass: (tmpActive && tmpActive.Key === pList.Key) ? 'pspe-rail-item-on' : ''
			})),
			EmptySlot: this._loaded.WordLists.length ? [] : [{ Text: 'No word lists yet.' }],
			DetailSlot: [],
			NoSelectionSlot: []
		};
		if (tmpActive && !pReadOnly)
		{
			let tmpTotal = this._wordListTotal(tmpActive);
			tmpPane.DetailSlot =
			[{
				ViewHash: this.Hash,
				Key: tmpActive.Key,
				Name: tmpActive.Name,
				ExpressionExample: '{~WordListEntry:' + tmpActive.Name + '~}',
				Entries: (tmpActive.Entries || []).map((pEntry, pIndex) => (
				{
					ViewHash: this.Hash,
					Index: pIndex,
					Word: pEntry[0],
					Weight: pEntry[1],
					Percent: this._entryShare(pEntry[1], tmpTotal)
				}))
			}];
		}
		else if (tmpActive && pReadOnly)
		{
			tmpPane.NoSelectionSlot = [{ Text: tmpActive.Name + ': ' + (tmpActive.Entries || []).map((pEntry) => pEntry[0] + ' (' + pEntry[1] + ')').join(', ') }];
		}
		else
		{
			tmpPane.NoSelectionSlot = [{ Text: pReadOnly ? 'Nothing to show.' : 'Create a word list to template against.' }];
		}
		return tmpPane;
	}

	_shapeGeneratedPane(pReadOnly)
	{
		let tmpActive = this._findGenerated(this._ui.ActiveGeneratedKey);
		let tmpPane =
		{
			ViewHash: this.Hash,
			Note: this._loaded.Generated.length
				? (this._loaded.Generated.length + ' generated prompt' + (this._loaded.Generated.length === 1 ? '' : 's') + ', in file order. The zip holds them all as markdown files.')
				: 'Generate from a prompt and the output lands here.',
			ToolsSlot: (this._loaded.Generated.length && !pReadOnly) ? [{ ViewHash: this.Hash }] : [],
			Generated: this._loaded.Generated.map((pGenerated) => (
			{
				ViewHash: this.Hash,
				Key: pGenerated.Key,
				FileName: libCompiler.generatedFileName(pGenerated),
				Sub: (pGenerated.PromptTitle || 'untitled') + ' · ' + this._ago(pGenerated.GeneratedAt),
				OnClass: (tmpActive && tmpActive.Key === pGenerated.Key) ? 'pspe-rail-item-on' : ''
			})),
			EmptySlot: this._loaded.Generated.length ? [] : [{ Text: 'Nothing generated yet.' }],
			ViewerSlot: [],
			NoSelectionSlot: []
		};
		if (tmpActive)
		{
			tmpPane.ViewerSlot = [{ ViewHash: this.Hash, MarkdownHtml: this._renderMarkdown(tmpActive.Markdown) }];
		}
		else if (this._loaded.Generated.length)
		{
			tmpPane.NoSelectionSlot = [{ Text: 'Pick a generated prompt to read it.' }];
		}
		return tmpPane;
	}

	_reshape() { this._shape(); this.render(); }

	// ---- tab + selection handlers ------------------------------------------------
	selectTab(pTab) { this._ui.Tab = pTab; this._reshape(); }
	selectPrompt(pKey)
	{
		if (this._ui.ActivePromptKey !== pKey) { this._ui.Preview = null; }
		this._ui.ActivePromptKey = pKey;
		this._reshape();
	}
	selectWordList(pKey) { this._ui.ActiveWordListKey = pKey; this._reshape(); }
	selectGenerated(pKey) { this._ui.ActiveGeneratedKey = pKey; this._reshape(); }

	// ---- prompt handlers -----------------------------------------------------------
	newPrompt()
	{
		let tmpTypeKey = this._types.length ? this._types[0].Key : 'freeform';
		this._provider.createPrompt({ TypeKey: tmpTypeKey, Title: 'Untitled prompt', Author: this.options.CurrentUser })
			.then((pPrompt) =>
			{
				this._ui.ActivePromptKey = pPrompt.Key;
				this._fire('onPromptSaved', pPrompt);
				return this.load();
			})
			.catch((pError) => this._toast('Could not create the prompt: ' + pError.message, 'error'));
	}

	cachePromptTitle(pValue)
	{
		let tmpPrompt = this._activePrompt();
		if (!tmpPrompt) { return; }
		tmpPrompt.Title = pValue;
		// Mirror into the rail in place; no re-render while typing.
		this.pict.ContentAssignment.assignContent('#pspe-prname-' + this.Hash + '-' + tmpPrompt.Key, this._escapeHtml(pValue || 'Untitled prompt'));
	}

	savePromptTitle()
	{
		let tmpPrompt = this._activePrompt();
		if (!tmpPrompt) { return; }
		this._provider.updatePrompt(tmpPrompt.Key, { Title: tmpPrompt.Title })
			.then((pSaved) => { this._fire('onPromptSaved', pSaved); })
			.catch((pError) => this._toast('Title save failed: ' + pError.message, 'error'));
	}

	setPromptType(pTypeKey)
	{
		let tmpPrompt = this._activePrompt();
		if (!tmpPrompt) { return; }
		// Non-destructive: segment bodies stay keyed in the prompt; switching
		// types changes which segments show and compile.
		tmpPrompt.TypeKey = pTypeKey;
		this._provider.updatePrompt(tmpPrompt.Key, { TypeKey: pTypeKey })
			.then((pSaved) => { this._fire('onPromptSaved', pSaved); this._reshape(); })
			.catch((pError) => this._toast('Type change failed: ' + pError.message, 'error'));
	}

	duplicatePrompt()
	{
		let tmpPrompt = this._activePrompt();
		if (!tmpPrompt) { return; }
		this._provider.createPrompt(
			{
				TypeKey: tmpPrompt.TypeKey,
				Title: tmpPrompt.Title + ' (copy)',
				Segments: JSON.parse(JSON.stringify(tmpPrompt.Segments || {})),
				IncludeSegmentHeadings: tmpPrompt.IncludeSegmentHeadings !== false,
				Meta: JSON.parse(JSON.stringify(tmpPrompt.Meta || {})),
				Author: this.options.CurrentUser
			})
			.then((pCopy) =>
			{
				this._ui.ActivePromptKey = pCopy.Key;
				this._fire('onPromptSaved', pCopy);
				return this.load();
			})
			.catch((pError) => this._toast('Duplicate failed: ' + pError.message, 'error'));
	}

	deletePrompt()
	{
		let tmpPrompt = this._activePrompt();
		if (!tmpPrompt) { return; }
		let tmpModal = this._modal();
		let fDelete = () => this._provider.deletePrompt(tmpPrompt.Key)
			.then(() => { this._fire('onPromptDeleted', tmpPrompt); this._ui.ActivePromptKey = null; return this.load(); })
			.catch((pError) => this._toast('Delete failed: ' + pError.message, 'error'));
		if (tmpModal && typeof tmpModal.confirm === 'function')
		{
			tmpModal.confirm('Delete "' + (tmpPrompt.Title || 'this prompt') + '" and everything generated from it?', { title: 'Delete prompt?', confirmLabel: 'Delete', dangerous: true })
				.then((pOk) => { if (pOk) { fDelete(); } });
		}
		else { fDelete(); }
	}

	// ---- segment handlers ----------------------------------------------------------
	cacheSegment(pSegmentKey, pValue)
	{
		let tmpPrompt = this._activePrompt();
		if (!tmpPrompt) { return; }
		if (!tmpPrompt.Segments) { tmpPrompt.Segments = {}; }
		tmpPrompt.Segments[pSegmentKey] = pValue;
	}

	saveSegment(pSegmentKey)
	{
		let tmpPrompt = this._activePrompt();
		if (!tmpPrompt) { return; }
		this._provider.updatePrompt(tmpPrompt.Key, { Segments: tmpPrompt.Segments })
			.then((pSaved) => { this._fire('onPromptSaved', pSaved); })
			.catch((pError) => this._toast('Segment save failed: ' + pError.message, 'error'));
	}

	// The per-prompt "segment headings in the output" toggle: saves with the
	// prompt, and the compiler reads it on every assemble (preview, generate,
	// zip). No re-render needed - the checkbox itself holds the new state -
	// but an open preview re-rolls so what you see matches what you would get.
	setSegmentHeadings(pChecked)
	{
		let tmpPrompt = this._activePrompt();
		if (!tmpPrompt) { return; }
		tmpPrompt.IncludeSegmentHeadings = !!pChecked;
		this._provider.updatePrompt(tmpPrompt.Key, { IncludeSegmentHeadings: !!pChecked })
			.then((pSaved) =>
			{
				this._fire('onPromptSaved', pSaved);
				if (this._ui.Preview && this._ui.Preview.PromptKey === tmpPrompt.Key) { this.previewOnce(); }
			})
			.catch((pError) => this._toast('Save failed: ' + pError.message, 'error'));
	}

	toggleSegmentPreview(pSegmentKey)
	{
		let tmpPrompt = this._activePrompt();
		if (!tmpPrompt) { return; }
		let tmpPreviewKey = tmpPrompt.Key + ':' + pSegmentKey;
		this._ui.PreviewSegments[tmpPreviewKey] = !this._ui.PreviewSegments[tmpPreviewKey];
		this._reshape();
	}

	// Insert {~WordListEntry:Name~} at the caret of the segment's textarea.
	insertWordList(pSegmentKey, pListName, pTextareaId)
	{
		if (!pListName) { return; }
		let tmpExpression = '{~WordListEntry:' + pListName + '~}';
		let tmpTextarea = (typeof document !== 'undefined') ? document.getElementById(pTextareaId) : null;
		if (tmpTextarea)
		{
			let tmpStart = (typeof tmpTextarea.selectionStart === 'number') ? tmpTextarea.selectionStart : tmpTextarea.value.length;
			let tmpEnd = (typeof tmpTextarea.selectionEnd === 'number') ? tmpTextarea.selectionEnd : tmpStart;
			tmpTextarea.value = tmpTextarea.value.slice(0, tmpStart) + tmpExpression + tmpTextarea.value.slice(tmpEnd);
			tmpTextarea.focus();
			tmpTextarea.selectionStart = tmpTextarea.selectionEnd = tmpStart + tmpExpression.length;
			this.cacheSegment(pSegmentKey, tmpTextarea.value);
		}
		else
		{
			let tmpPrompt = this._activePrompt();
			if (!tmpPrompt) { return; }
			this.cacheSegment(pSegmentKey, String((tmpPrompt.Segments || {})[pSegmentKey] || '') + tmpExpression);
		}
		this.saveSegment(pSegmentKey);
	}

	// The full pict-section-markdowneditor, hosted in a modal, editing one segment.
	openRichEditor(pSegmentKey)
	{
		let tmpPrompt = this._activePrompt();
		let tmpModal = this._modal();
		if (!tmpPrompt || !tmpModal || typeof tmpModal.show !== 'function') { return; }
		let tmpModules = this.options.CodeMirrorModules || ((typeof window !== 'undefined') ? window.CodeMirrorModules : null);
		if (!tmpModules)
		{
			this._toast('The rich editor needs CodeMirror; the inline editor still works.', 'info');
			return;
		}

		// The rich editor reads segments from a fable-manifest address; keep it
		// bracket-free by keying a dedicated AppData node on a sanitized hash.
		let tmpRichKey = 'PromptEditorRich_' + String(this.Hash).replace(/[^A-Za-z0-9_]/g, '_');
		if (!this.pict.AppData[tmpRichKey]) { this.pict.AppData[tmpRichKey] = {}; }
		this.pict.AppData[tmpRichKey].Segments = [{ Content: String((tmpPrompt.Segments || {})[pSegmentKey] || '') }];
		this._richDataKey = tmpRichKey;

		if (!this._richEditorViewHash)
		{
			this._richEditorViewHash = 'PromptEditor-MDE-' + this.Hash;
			this.pict.addView(this._richEditorViewHash, Object.assign({}, libMarkdownEditor.default_configuration,
			{
				ViewIdentifier: this._richEditorViewHash,
				AutoRender: false,
				DefaultDestinationAddress: '#pspe-rich-host-' + this.Hash,
				// The editor builds its UI into TargetElementAddress directly
				// (separate from the renderable destination).
				TargetElementAddress: '#pspe-rich-host-' + this.Hash,
				ContentDataAddress: 'AppData.' + tmpRichKey + '.Segments',
				DefaultPreviewMode: 'side'
			}), libMarkdownEditor);
		}

		let tmpEditor = this.pict.views[this._richEditorViewHash];
		let tmpSelf = this;
		tmpModal.show(
		{
			title: 'Edit segment',
			content: '<div class="pspe-rich-host" id="pspe-rich-host-' + this.Hash + '"></div>',
			width: '860px',
			buttons:
			[
				{ Hash: 'cancel', Label: 'Cancel' },
				{ Hash: 'save', Label: 'Save', Style: 'primary' }
			],
			onOpen: function ()
			{
				try
				{
					tmpEditor.connectCodeMirrorModules(tmpModules);
					tmpEditor.render();
					tmpEditor.marshalToView();
				}
				catch (pError) { tmpSelf._toast('Rich editor failed to start: ' + pError.message, 'error'); }
			}
		}).then((pChoice) =>
		{
			if (pChoice !== 'save') { return; }
			try { tmpEditor.marshalFromView(); } catch (pError) { /* fall back to whatever is in AppData */ }
			let tmpSegments = (tmpSelf.pict.AppData[tmpSelf._richDataKey] || {}).Segments || [];
			let tmpContent = tmpSegments.map((pSegment) => String(pSegment.Content || '')).join('\n\n');
			tmpSelf.cacheSegment(pSegmentKey, tmpContent);
			tmpSelf.saveSegment(pSegmentKey);
			tmpSelf._reshape();
		});
	}

	// ---- generation -------------------------------------------------------------------
	setGenerateCount(pValue)
	{
		let tmpCount = Math.max(1, Math.min(this.options.GenerateMaxCount, Number(pValue) || 1));
		this._ui.GenerateCount = tmpCount;
	}

	_generateOnce(pPrompt, pType)
	{
		return libCompiler.generate(this.pict, pPrompt, pType, this._loaded.WordLists,
			{
				IncludeTitleHeading: this.options.IncludeTitleHeading,
				SegmentHeadingLevel: this.options.SegmentHeadingLevel,
				RandomFunction: (typeof this.options.RandomFunction === 'function') ? this.options.RandomFunction : undefined
			});
	}

	generatePrompts()
	{
		let tmpPrompt = this._activePrompt();
		if (!tmpPrompt) { return; }
		let tmpType = libTypes.getPromptType(this._types, tmpPrompt.TypeKey);
		let tmpCount = this._ui.GenerateCount;
		let tmpExisting = this._loaded.Generated.filter((pGenerated) => pGenerated.PromptKey === tmpPrompt.Key).length;

		let tmpCreates = [];
		for (let i = 0; i < tmpCount; i++)
		{
			tmpCreates.push(this._provider.createGenerated(
				{
					PromptKey: tmpPrompt.Key,
					PromptTitle: tmpPrompt.Title,
					TypeKey: tmpPrompt.TypeKey,
					Markdown: this._generateOnce(tmpPrompt, tmpType),
					Sequence: tmpExisting + i + 1,
					Author: this.options.CurrentUser
				}));
		}
		Promise.all(tmpCreates)
			.then((pBatch) =>
			{
				this._fire('onGenerated', pBatch);
				this._toast('Generated ' + pBatch.length + ' prompt' + (pBatch.length === 1 ? '' : 's') + '.', 'success');
				this._ui.Tab = 'generated';
				if (pBatch.length) { this._ui.ActiveGeneratedKey = pBatch[0].Key; }
				return this.load();
			})
			.catch((pError) => this._toast('Generation failed: ' + pError.message, 'error'));
	}

	// Roll the active prompt once, without saving, into the preview panel below
	// the editor. Rolling again replaces it; closing clears it; switching
	// prompts drops it.
	previewOnce()
	{
		let tmpPrompt = this._activePrompt();
		if (!tmpPrompt) { return; }
		let tmpType = libTypes.getPromptType(this._types, tmpPrompt.TypeKey);
		this._ui.Preview = { PromptKey: tmpPrompt.Key, Markdown: this._generateOnce(tmpPrompt, tmpType) };
		this._reshape();
	}

	closePreview()
	{
		this._ui.Preview = null;
		this._reshape();
	}

	// 'rendered' shows the formatted markdown; 'raw' shows the source. The
	// choice is sticky for the session.
	setPreviewMode(pMode)
	{
		this._ui.PreviewMode = (pMode === 'raw') ? 'raw' : 'rendered';
		this._reshape();
	}

	copyPreview()
	{
		if (!this._ui.Preview) { return; }
		this._copyToClipboard(this._ui.Preview.Markdown, 'Prompt');
	}

	// ---- word list handlers ----------------------------------------------------------
	newWordList()
	{
		let tmpBase = 'New word list';
		let tmpName = tmpBase;
		let tmpNumber = 2;
		while (this._loaded.WordLists.some((pList) => pList.Name === tmpName)) { tmpName = tmpBase + ' ' + tmpNumber++; }
		this._provider.createWordList({ Name: tmpName, Entries: [['', 1]] })
			.then((pList) =>
			{
				this._ui.ActiveWordListKey = pList.Key;
				this._ui.Tab = 'wordlists';
				this._fire('onWordListSaved', pList);
				return this.load();
			})
			.catch((pError) => this._toast('Could not create the word list: ' + pError.message, 'error'));
	}

	cacheWordListName(pValue)
	{
		let tmpList = this._activeWordList();
		if (!tmpList) { return; }
		tmpList.Name = pValue;
		// Mirror into the rail in place; no re-render while typing.
		this.pict.ContentAssignment.assignContent('#pspe-wlname-' + this.Hash + '-' + tmpList.Key, this._escapeHtml(pValue));
	}

	saveWordListName()
	{
		let tmpList = this._activeWordList();
		if (!tmpList) { return; }
		this._provider.updateWordList(tmpList.Key, { Name: tmpList.Name })
			.then((pSaved) => { this._fire('onWordListSaved', pSaved); })
			.catch((pError) => this._toast('Rename failed: ' + pError.message, 'error'));
	}

	deleteWordList()
	{
		let tmpList = this._activeWordList();
		if (!tmpList) { return; }
		let tmpModal = this._modal();
		let fDelete = () => this._provider.deleteWordList(tmpList.Key)
			.then(() => { this._fire('onWordListDeleted', tmpList); this._ui.ActiveWordListKey = null; return this.load(); })
			.catch((pError) => this._toast('Delete failed: ' + pError.message, 'error'));
		if (tmpModal && typeof tmpModal.confirm === 'function')
		{
			tmpModal.confirm('Delete the word list "' + tmpList.Name + '"? Prompts referencing it will show the expression unresolved.', { title: 'Delete word list?', confirmLabel: 'Delete', dangerous: true })
				.then((pOk) => { if (pOk) { fDelete(); } });
		}
		else { fDelete(); }
	}

	// Value edits never re-render: a render replaces the DOM and destroys the
	// input mid-interaction (number spinners fire change on every click, so a
	// render-on-save makes the arrows unusable). Cache + targeted share refresh
	// on input, debounced persist; structural changes (add/remove) re-render.
	cacheEntryWord(pIndex, pValue)
	{
		let tmpList = this._activeWordList();
		if (tmpList && tmpList.Entries[pIndex]) { tmpList.Entries[pIndex][0] = pValue; }
		this._scheduleEntriesSave();
	}

	cacheEntryWeight(pIndex, pValue)
	{
		let tmpList = this._activeWordList();
		if (tmpList && tmpList.Entries[pIndex]) { tmpList.Entries[pIndex][1] = pValue; }
		this._refreshShareCells();
		this._scheduleEntriesSave();
	}

	saveEntries()
	{
		if (this._entriesSaveTimer) { clearTimeout(this._entriesSaveTimer); this._entriesSaveTimer = null; }
		let tmpList = this._activeWordList();
		if (!tmpList) { return Promise.resolve(); }
		return this._provider.updateWordList(tmpList.Key, { Entries: tmpList.Entries })
			.then((pSaved) =>
			{
				// Adopt the normalized entries (weights coerced) and refresh the
				// shares in place. The inputs themselves are left alone so typing
				// in progress is never clobbered.
				tmpList.Entries = pSaved.Entries;
				this._fire('onWordListSaved', pSaved);
				this._refreshShareCells();
			})
			.catch((pError) => this._toast('Save failed: ' + pError.message, 'error'));
	}

	addWordListEntry()
	{
		let tmpList = this._activeWordList();
		if (!tmpList) { return; }
		tmpList.Entries.push(['', 1]);
		this._reshape();
		this.saveEntries();
	}

	removeWordListEntry(pIndex)
	{
		let tmpList = this._activeWordList();
		if (!tmpList) { return; }
		tmpList.Entries.splice(pIndex, 1);
		this._reshape();
		this.saveEntries();
	}

	// ---- generated handlers -------------------------------------------------------------
	deleteGenerated()
	{
		let tmpGenerated = this._findGenerated(this._ui.ActiveGeneratedKey);
		if (!tmpGenerated) { return; }
		this._provider.deleteGenerated(tmpGenerated.Key)
			.then(() => { this._ui.ActiveGeneratedKey = null; return this.load(); })
			.catch((pError) => this._toast('Delete failed: ' + pError.message, 'error'));
	}

	clearGenerated()
	{
		let tmpModal = this._modal();
		let fClear = () => this._provider.clearGenerated()
			.then(() => { this._ui.ActiveGeneratedKey = null; return this.load(); })
			.catch((pError) => this._toast('Clear failed: ' + pError.message, 'error'));
		if (tmpModal && typeof tmpModal.confirm === 'function')
		{
			tmpModal.confirm('Remove every generated prompt? The source prompts stay.', { title: 'Clear generated?', confirmLabel: 'Clear', dangerous: true })
				.then((pOk) => { if (pOk) { fClear(); } });
		}
		else { fClear(); }
	}

	copyGenerated()
	{
		let tmpGenerated = this._findGenerated(this._ui.ActiveGeneratedKey);
		if (!tmpGenerated) { return; }
		this._copyToClipboard(tmpGenerated.Markdown, 'Markdown');
	}

	downloadZip()
	{
		let tmpFiles = this._loaded.Generated.map((pGenerated) => (
		{
			Name: libCompiler.generatedFileName(pGenerated),
			Content: pGenerated.Markdown
		}));
		if (!tmpFiles.length) { this._toast('Nothing generated yet.', 'info'); return; }
		libZip.buildZip(tmpFiles)
			.then((pBlob) => libZip.downloadBlob(pBlob, this.options.ZipFileName))
			.then(() => this._toast('Zip on the way: ' + tmpFiles.length + ' file' + (tmpFiles.length === 1 ? '' : 's') + '.', 'success'))
			.catch((pError) => this._toast('Zip failed: ' + pError.message, 'error'));
	}
}

module.exports = PictViewPromptEditor;
module.exports.default_configuration = _DefaultConfiguration;
