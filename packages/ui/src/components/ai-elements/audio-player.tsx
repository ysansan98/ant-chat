'use client'

import type { Experimental_SpeechResult as SpeechResult } from 'ai'
import type { ComponentProps, CSSProperties } from 'react'
import { Button } from '@workspace/ui/components/button'
import {
  ButtonGroup,
  ButtonGroupText,
} from '@workspace/ui/components/button-group'
import { cn } from '@workspace/ui/lib/utils'
import {
  MediaControlBar,
  MediaController,
  MediaDurationDisplay,
  MediaMuteButton,
  MediaPlayButton,
  MediaSeekBackwardButton,
  MediaSeekForwardButton,
  MediaTimeDisplay,
  MediaTimeRange,
  MediaVolumeRange,
} from 'media-chrome/react'

export type AudioPlayerProps = Omit<
  ComponentProps<typeof MediaController>,
  'audio'
>

export function AudioPlayer({
  children,
  style,
  ...props
}: AudioPlayerProps) {
  return (
    <MediaController
      audio
      data-slot="audio-player"
      style={
        {
          '--media-background-color': 'transparent',
          '--media-button-icon-height': '1rem',
          '--media-button-icon-width': '1rem',
          '--media-control-background': 'transparent',
          '--media-control-hover-background': 'var(--color-accent)',
          '--media-control-padding': '0',
          '--media-font': 'var(--font-sans)',
          '--media-font-size': '10px',
          '--media-icon-color': 'currentColor',
          '--media-preview-time-background': 'var(--color-background)',
          '--media-preview-time-border-radius': 'var(--radius-md)',
          '--media-preview-time-text-shadow': 'none',
          '--media-primary-color': 'var(--color-primary)',
          '--media-range-bar-color': 'var(--color-primary)',
          '--media-range-track-background': 'var(--color-secondary)',
          '--media-secondary-color': 'var(--color-secondary)',
          '--media-text-color': 'var(--color-foreground)',
          '--media-tooltip-arrow-display': 'none',
          '--media-tooltip-background': 'var(--color-background)',
          '--media-tooltip-border-radius': 'var(--radius-md)',
          ...style,
        } as CSSProperties
      }
      {...props}
    >
      {children}
    </MediaController>
  )
}

export type AudioPlayerElementProps = Omit<ComponentProps<'audio'>, 'src'>
  & (
    | {
      data: SpeechResult['audio']
    }
    | {
      src: string
    }
  )

export function AudioPlayerElement({ ...props }: AudioPlayerElementProps) {
  return (
    <audio
      data-slot="audio-player-element"
      slot="media"
      src={
        'src' in props
          ? props.src
          : `data:${props.data.mediaType};base64,${props.data.base64}`
      }
      {...props}
    />
  )
}

export type AudioPlayerControlBarProps = ComponentProps<typeof MediaControlBar>

export function AudioPlayerControlBar({
  children,
  ...props
}: AudioPlayerControlBarProps) {
  return (
    <MediaControlBar data-slot="audio-player-control-bar" {...props}>
      <ButtonGroup orientation="horizontal">{children}</ButtonGroup>
    </MediaControlBar>
  )
}

export type AudioPlayerPlayButtonProps = ComponentProps<typeof MediaPlayButton>

export function AudioPlayerPlayButton({
  className,
  ...props
}: AudioPlayerPlayButtonProps) {
  return (
    <Button asChild size="icon-sm" variant="outline">
      <MediaPlayButton
        className={cn('bg-transparent', className)}
        data-slot="audio-player-play-button"
        {...props}
      />
    </Button>
  )
}

export type AudioPlayerSeekBackwardButtonProps = ComponentProps<
  typeof MediaSeekBackwardButton
>

export function AudioPlayerSeekBackwardButton({
  seekOffset = 10,
  ...props
}: AudioPlayerSeekBackwardButtonProps) {
  return (
    <Button asChild size="icon-sm" variant="outline">
      <MediaSeekBackwardButton
        data-slot="audio-player-seek-backward-button"
        seekOffset={seekOffset}
        {...props}
      />
    </Button>
  )
}

export type AudioPlayerSeekForwardButtonProps = ComponentProps<
  typeof MediaSeekForwardButton
>

export function AudioPlayerSeekForwardButton({
  seekOffset = 10,
  ...props
}: AudioPlayerSeekForwardButtonProps) {
  return (
    <Button asChild size="icon-sm" variant="outline">
      <MediaSeekForwardButton
        data-slot="audio-player-seek-forward-button"
        seekOffset={seekOffset}
        {...props}
      />
    </Button>
  )
}

export type AudioPlayerTimeDisplayProps = ComponentProps<
  typeof MediaTimeDisplay
>

export function AudioPlayerTimeDisplay({
  className,
  ...props
}: AudioPlayerTimeDisplayProps) {
  return (
    <ButtonGroupText asChild className="bg-transparent">
      <MediaTimeDisplay
        className={cn('tabular-nums', className)}
        data-slot="audio-player-time-display"
        {...props}
      />
    </ButtonGroupText>
  )
}

export type AudioPlayerTimeRangeProps = ComponentProps<typeof MediaTimeRange>

export function AudioPlayerTimeRange({
  className,
  ...props
}: AudioPlayerTimeRangeProps) {
  return (
    <ButtonGroupText asChild className="bg-transparent">
      <MediaTimeRange
        className={cn('', className)}
        data-slot="audio-player-time-range"
        {...props}
      />
    </ButtonGroupText>
  )
}

export type AudioPlayerDurationDisplayProps = ComponentProps<
  typeof MediaDurationDisplay
>

export function AudioPlayerDurationDisplay({
  className,
  ...props
}: AudioPlayerDurationDisplayProps) {
  return (
    <ButtonGroupText asChild className="bg-transparent">
      <MediaDurationDisplay
        className={cn('tabular-nums', className)}
        data-slot="audio-player-duration-display"
        {...props}
      />
    </ButtonGroupText>
  )
}

export type AudioPlayerMuteButtonProps = ComponentProps<typeof MediaMuteButton>

export function AudioPlayerMuteButton({
  className,
  ...props
}: AudioPlayerMuteButtonProps) {
  return (
    <ButtonGroupText asChild className="bg-transparent">
      <MediaMuteButton
        className={cn('', className)}
        data-slot="audio-player-mute-button"
        {...props}
      />
    </ButtonGroupText>
  )
}

export type AudioPlayerVolumeRangeProps = ComponentProps<
  typeof MediaVolumeRange
>

export function AudioPlayerVolumeRange({
  className,
  ...props
}: AudioPlayerVolumeRangeProps) {
  return (
    <ButtonGroupText asChild className="bg-transparent">
      <MediaVolumeRange
        className={cn('', className)}
        data-slot="audio-player-volume-range"
        {...props}
      />
    </ButtonGroupText>
  )
}
