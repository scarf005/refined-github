import React from 'dom-chef';
import cache from 'webext-storage-cache';
import {isChrome} from 'webext-detect-page';
import * as pageDetect from 'github-url-detection';
import {GitPullRequestIcon} from '@primer/octicons-react';

import features from '../feature-manager';
import * as api from '../github-helpers/api';
import getDefaultBranch from '../github-helpers/get-default-branch';
import {buildRepoURL, cacheByRepo} from '../github-helpers';
import GitHubURL from '../github-helpers/github-url';
import observe from '../helpers/selector-observer';

function getPRUrl(prNumber: number): string {
	return buildRepoURL('pull', prNumber, 'files');
}

function getHovercardUrl(prNumber: number): string {
	return buildRepoURL('pull', prNumber, 'hovercard');
}

function getDropdown(prs: number[]): HTMLElement {
	// Markup copied from https://primer.style/css/components/dropdown
	return (
		<details className="dropdown details-reset details-overlay flex-self-center">
			<summary className="btn btn-sm">
				<GitPullRequestIcon className="v-align-middle"/>
				<span className="v-align-middle"> {prs.length} </span>
				<div className="dropdown-caret"/>
			</summary>

			<details-menu className="dropdown-menu dropdown-menu-sw">
				<div className="dropdown-header">
					File touched by PRs
				</div>
				{prs.map(prNumber => (
					<a
						className="dropdown-item"
						href={getPRUrl(prNumber)}
						data-hovercard-url={getHovercardUrl(prNumber)}
					>
						#{prNumber}
					</a>
				))}
			</details-menu>
		</details>
	);
}

function getSingleButton(prNumber: number): HTMLElement {
	return (
		<a
			href={getPRUrl(prNumber)}
			className="btn btn-sm flex-self-center"
			data-hovercard-url={getHovercardUrl(prNumber)}
		>
			<GitPullRequestIcon className="v-align-middle"/>
			<span className="v-align-middle"> #{prNumber}</span>
		</a>
	);
}

/**
@returns prsByFile {"filename1": [10, 3], "filename2": [2]}
*/
const getPrsByFile = cache.function('files-with-prs', async (): Promise<Record<string, number[]>> => {
	const {repository} = await api.v4(`
		repository() {
			pullRequests(
				first: 25,
				states: OPEN,
				baseRefName: "${await getDefaultBranch()}",
				orderBy: {
					field: UPDATED_AT,
					direction: DESC
				}
			) {
				nodes {
					number
					files(first: 100) {
						nodes {
							path
						}
					}
				}
			}
		}
	`);

	const files: Record<string, number[]> = {};

	for (const pr of repository.pullRequests.nodes) {
		for (const {path} of pr.files.nodes) {
			files[path] = files[path] ?? [];
			if (files[path].length < 10) {
				files[path].push(pr.number);
			}
		}
	}

	return files;
}, {
	maxAge: {hours: 2},
	staleWhileRevalidate: {days: 9},
	cacheKey: cacheByRepo,
});

async function addToSingleFile(moreFileActionsDropdown: HTMLElement): Promise<void> {
	const path = new GitHubURL(location.href).filePath;
	const prsByFile = await getPrsByFile();
	const prs = prsByFile[path];

	if (!prs) {
		return;
	}

	const [prNumber] = prs; // First one or only one

	const button = prs.length === 1 ? getSingleButton(prNumber) : getDropdown(prs);

	moreFileActionsDropdown.before(button);
}

async function addToEditingFile(file: HTMLElement): Promise<false | void> {
	const path = new GitHubURL(location.href).filePath;
	const prsByFile = await getPrsByFile();
	let prs = prsByFile[path];

	if (!prs) {
		return;
	}

	const editingPRNumber = new URLSearchParams(location.search).get('pr')?.split('/').slice(-1);
	if (editingPRNumber) {
		prs = prs.filter(pr => pr !== Number(editingPRNumber));
		if (prs.length === 0) {
			return;
		}
	}

	const [prNumber] = prs; // First one or only one

	file.after(
		<div className="form-warning p-3 mb-3 mx-lg-3">
			{
				prs.length === 1
					? <>Careful, PR <a href={getPRUrl(prNumber)}>#{prNumber}</a> is already touching this file</>
					: (
						<>
							Careful, {prs.length} open PRs are already touching this file
							<span className="ml-2 BtnGroup">
								{prs.map(pr => {
									const button = getSingleButton(pr) as unknown as HTMLAnchorElement;
									button.classList.add('BtnGroup-item');

									// Only Chrome supports Scroll To Text Fragment
									// https://caniuse.com/url-scroll-to-text-fragment
									if (isChrome()) {
										button.hash = `:~:text=${path}`;
									}

									return button;
								})}
							</span>
						</>
					)
			}
		</div>,
	);
}

function initSingleFile(signal: AbortSignal): void {
	observe('[aria-label="More file actions"]', addToSingleFile, {signal});
}

function initEditingFile(signal: AbortSignal): void {
	observe('.file', addToEditingFile, {signal});
}

void features.add(import.meta.url, {
	include: [
		pageDetect.isSingleFile,
	],
	init: initSingleFile,
}, {
	include: [
		pageDetect.isEditingFile,
	],
	exclude: [
		pageDetect.isBlank,
	],
	awaitDomReady: true, // End of the page; DOM-based detections
	init: initEditingFile,
});
