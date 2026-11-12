import { isNightlyOnly, nightlyTooltip } from '../../../site/release-status';

type MdNode = {
	type: string;
	name?: string;
	value?: string;
	children?: MdNode[];
	data?: Record<string, unknown>;
};

const textOf = (node: MdNode): string => node.value ?? (node.children ?? []).map(textOf).join('');

/**
 * Renders the `:since[0.3.2]` text directive, which marks the heading or
 * paragraph it sits in as newer than the latest release when it was written
 * (that release + 0.0.1): a "Nightly" badge until a release reaches that
 * version, nothing afterwards. `:since[nightly]` keeps the badge until it is
 * replaced with a version. The badge has no text content (theme.css
 * draws the label), and the whitespace before the directive is dropped, so
 * heading anchors do not change when the release comes out.
 */
export function remarkSince() {
	return (tree: MdNode, file: { path?: string }) => {
		const lang = file.path?.includes('/content/docs/ja/') ? 'ja' : 'en';
		transform(tree, lang);
	};
}

function transform(parent: MdNode, lang: 'en' | 'ja') {
	const children = parent.children;
	if (!children) return;
	for (let i = 0; i < children.length; i++) {
		const node = children[i];
		if (node.type !== 'textDirective' || node.name !== 'since') {
			transform(node, lang);
			continue;
		}
		const since = textOf(node).trim();
		const prev = children[i - 1];
		if (prev?.type === 'text') prev.value = prev.value!.trimEnd();
		if (isNightlyOnly(since)) {
			node.children = [];
			node.data = {
				hName: 'span',
				hProperties: { className: ['nvr-nightly'], title: nightlyTooltip(since, lang) },
			};
		} else {
			children.splice(i, 1);
			i--;
		}
	}
}
