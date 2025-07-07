#!/usr/bin/env python3
import base64
import os
import json
import datetime
from pathlib import Path
import re
import shutil
from moviepy import VideoFileClip, concatenate_videoclips


def parse_timestamp(timestamp_ms):
    """Convert timestamp in milliseconds to a datetime object."""
    return datetime.datetime.fromtimestamp(timestamp_ms / 1000)


def parse_timestamp_format(timestamp_ms):
    """Convert timestamp in milliseconds to a datetime object in ISO format."""
    return datetime.datetime.fromtimestamp(timestamp_ms / 1000).isoformat()

def timestamp_ms_to_seconds(timestamp_ms):
    """Convert timestamp in milliseconds to seconds."""
    return int(timestamp_ms / 1000)

def get_video_duration(video_path):
    """Get the duration of a video file using moviepy."""
    clip = VideoFileClip(video_path)
    duration = clip.duration
    clip.close()
    return int(duration)

def get_video_duration_ms(video_path):
    """Get the duration of a video file using moviepy."""
    clip = VideoFileClip(video_path)
    duration = clip.duration
    clip.close()
    duration_ms = int(duration * 1000)
    return duration_ms

def combine_numbered_videos(folder_path):
    """Combine numbered videos by clipping from highest to lowest."""
    print('combine_numbered_videos', folder_path)
    videos = {}
    for file in os.listdir(folder_path):
        if file.endswith('.webm'):
            match = re.search(r'(.+)-(\d+)\.webm$', file)
            if match:
                videos[int(match.group(2))] = os.path.join(folder_path, file)
    print('videos', videos)
    if len(videos) == 0 or 0 not in videos:
        return None
    if len(videos) == 1:
        return videos[0]


    original_duration = get_video_duration(videos[0])
    sorted_nums = sorted(videos.keys(), reverse=True)
    clips = []
    
    for i, num in enumerate(sorted_nums):
        print('num', num)
        clip = VideoFileClip(videos[num])
        current_len = clip.duration
        if i == 0:
            clips.append(clip)
        else:
            prev_len = VideoFileClip(videos[sorted_nums[i-1]]).duration
            print('prev_len', prev_len)
            clip_len = current_len - prev_len
            print('clip_len', clip_len)
            if clip_len > 0:
                clips.append(clip.subclipped(0, clip_len))
                current_len = clip_len
    print('clips', clips)
    clips.reverse()
    final = concatenate_videoclips(clips)
    output = os.path.join(folder_path, f"{os.path.basename(list(videos.values())[0]).split('_')[0]}_combined.webm")
    final.write_videofile(output)
    # final.write_videofile(output, codec='libvpx-vp9', audio_codec='libvorbis', bitrate=None)
    final.close()
    return output

def extract_log_data(log_dir, output_dir):


    """Extract log data from JSON files in the specified directory."""
    log_data = []

    # Get all JSON files in the directory
    json_files = list(Path(log_dir).glob('**/*.json'))

    for json_file in json_files:
        print('json_file', json_file, json_file.name)
        # Extract the parent id from the containing folder
        parent_id = json_file.parent.name
        print('parent_id', parent_id)

        try:
            with open(json_file, 'r') as f:
                data = json.load(f)

            # If the file name starts with output then just add out directly
            if json_file.name.startswith('output'):
                print('output file found')
                log_data.append(data)
                continue

            # Extract timestamp and other data from all elements in the log
            if data and isinstance(data, list) and len(data) > 0:
                for item in data:
                    print('extracting data')
                    request_data = item.get('request', {})
                    # print('request_data', request_data)
                    metadata = request_data.get('metadata', {})
                    agent_run_create = request_data.get('agentRunCreate', {})

                    timestamp_ms = metadata.get('timestamp_ms')
                    print('timestamp', timestamp_ms)
                    if not timestamp_ms:
                        response_data = item.get('response', {})
                        timestamp_ms = response_data.get('timings', {}).get('root', {}).get('startTime', '')
                        print('weird timestamp', timestamp_ms)

                    if timestamp_ms:
                        print('RUNNING')
                        # Extract response data if available
                        response_data = item.get('response', {})
                        program_body = response_data.get('rawProgramBody', '')

                        # Extract action and return from program body
                        action_name = ''
                        return_value = {}
                        find_return_value = []
                        if program_body:
                            print('program body', program_body)
                            if 'think("' in program_body:
                                action_name = program_body.split('think("')[1].split('");')[0]
                            print('action_name', action_name)
                            find_return_value = program_body.split('return "')
                            print('find_return_value', find_return_value)

                        if len(find_return_value) > 1:
                            return_value = find_return_value[1].split('";')[0]
                            return_value = return_value.replace('\\', '').replace('\"', '"')
                            print('return_value', return_value)
                            try:
                                return_value = json.loads(return_value)
                            except Exception as e:
                                print(f"Error parsing return value: {e}, continuing with string value")
                                return_value = { "output": return_value }

                        # Save off the image str in "screenshot" into its own file
                        screenshot_path = ''
                        screenshot_name = ''
                        if 'screenshot' in request_data:
                            screenshot = request_data['screenshot']
                            print('screenshot found')
                            screenshot_data = screenshot.split(',')[1]
                            screenshot_name = f"{json_file.stem}_{item.get('id', 'unknown')}_screenshot.jpg"
                            screenshot_path = os.path.join(output_dir, 'screenshot', screenshot_name)
                            with open(screenshot_path, 'wb') as f:
                                f.write(base64.b64decode(screenshot_data))
                        print('return_value out', return_value)

                        log_entry = {
                            'parent_id': parent_id,
                            'timestamp': timestamp_ms_to_seconds(timestamp_ms),
                            'action': action_name,
                            'output': return_value,
                            'task': agent_run_create.get('task', ''),
                            'active_url': metadata.get('activeURL', '') or metadata.get('activeUrl', ''),
                            'program_body': program_body,
                            'id': agent_run_create.get('id', ''),
                            'workflow_run_id': agent_run_create.get('workflowRunId', ''),
                            'workflow_event_id': agent_run_create.get('workflowEventId', ''),
                            'screenshot': screenshot_name,
                        }
                        log_data.append(log_entry)
        except Exception as e:
            print(f"Error processing {json_file}: {e}")

    # Sort by timestamp
    log_data.sort(key=lambda x: x['timestamp'])
    print('RETURNING LOG DATA', log_data)
    return log_data


def extract_log_data_grouped(log_dir, output_dir):
    # iterate through all the folders in log_dir
    # for each folder, extract the log data
    # return a list of log data
    log_data = []
    output = []
    for folder in os.listdir(log_dir):
        if os.path.isdir(os.path.join(log_dir, folder)):

            # print('folder', folder)
            # if folder == 'final':
            #     # output = extract_log_data(os.path.join(log_dir, folder), output_dir)
            #     continue

            #look for .webm file of any name and get the duration
            full_folder_path = os.path.join(log_dir, folder)
            print('full_folder_path', full_folder_path)

            video_path = combine_numbered_videos(full_folder_path)
            video_duration = 0
            if video_path and os.path.exists(video_path):
                video_duration = get_video_duration(video_path)
                print(f"Video duration: {video_duration}")
                # copy the video to the output directory renaming it to the folder name
                shutil.copy(video_path, os.path.join(output_dir, 'video', folder + ".webm"))

            actions = extract_log_data(os.path.join(log_dir, folder), output_dir)
            earliest_timestamp = 0
            end_time = 0
            if actions:
                # find the earliest timestamp
                earliest_timestamp = min([int(item['timestamp']) for item in actions])
                #determine end time based on video duration as a whole number
                end_time = earliest_timestamp + video_duration

            log_data.append({'parent': folder, 'number_actions': len(actions),
                             'start_time': earliest_timestamp,
                             'end_time': end_time,
                             'actions': actions,
                             'video_duration': video_duration,
                             'video': folder + ".webm",
                             })

    for entry in log_data:
        print(entry)
        print('-----------------')


    # sort by start time
    log_data.sort(key=lambda x: x['start_time'])

    # some of these entries are happening in parallel, so we need to create an array that shows the flow and groups things happening parallel into a sub-array
    # for each entry, if the start time is less than the end time of the previous entry, add it to the sub-array
    # otherwise, start a new sub-array
    grouped_log_data = []
    current_group = []
    for i, entry in enumerate(log_data):
        if i == 0:
            current_group.append(entry)
        else:
            if entry['start_time'] < log_data[i-1]['end_time']:
                current_group.append(entry)
            else:
                grouped_log_data.append(current_group)
                current_group = [entry]
                # print('-----------------')
                # print(current_group)
                # print('-----------------')
    grouped_log_data.append(current_group)

    # if len(output) > 0: grouped_log_data.append(output)
    # find the time of the first step and subtract it from every timestamp in all groups
    # this way we can start from 0 and play this in real time
    run_start_time = grouped_log_data[0][0]['start_time']

    #subtract run_start_time from every timestamp in all groups
    for group in grouped_log_data:
        for entry in group:
            entry['start_time'] = entry['start_time'] - run_start_time
            entry['end_time'] = entry['end_time'] - run_start_time
            for action in entry['actions']:
                action['timestamp'] = action['timestamp'] - run_start_time
                action['start_time'] = action['timestamp']

    # add end step to overall array
    end_state = [
        {
            'parent': 'end',
            'start_time': grouped_log_data[-1][-1]['end_time'],
            'end_time': grouped_log_data[-1][-1]['end_time'],
            'video': '',
            'video_path': '',
            'video_duration': 0,
            'number_actions': 1,
            'actions': [
                {
                    'timestamp': grouped_log_data[-1][-1]['end_time'],
                    'start_time': grouped_log_data[-1][-1]['end_time'],
                    'action': 'Finish',
                    'output': {},
                    'task': '',
                    'active_url': '',
                    'program_body': '',
                    'id': 'end',
                    'workflow_run_id': 'end',
                    'workflow_event_id': 'end',
                    'screenshot': '',
                }
            ]
        }
    ]
    grouped_log_data.append(end_state)

    # print('-----------------')
    # print(grouped_log_data)
    # print('-------GROUPS----------')
    # for group in grouped_log_data:
    #     print('-----------------')
    #     print(group)
    #     for entry in group:
    #         print(entry['parent'])
    #     print('-----------------')

    # write out grouped_log_data to file
    final_output = {
        'workflow_steps': grouped_log_data
    }
    with open(output_dir +'/flow.json', 'w') as f:
        json.dump(final_output, f, indent=4, default=str)


def main(log_dir, output_dir):
    # Extract log data
    # log_data, workflow_groups, parent_groups = extract_log_data("../logs/apartments_caltrain")
    # print('LOG DATA', log_data)
    #
    # for entry in log_data:
    #     print(entry)
    #
    # print('WORKFLOW GROUPS', workflow_groups)
    #
    # for workflow_id, entries in workflow_groups.items():
    #     print(f"Workflow ID: {workflow_id}")
    #     for entry in entries:
    #         print(workflow_id)
    #
    # for parent_id, entries in parent_groups.items():
    #     print(f"Parent ID: {parent_id}")
    #     for entry in entries:
    #         print(entry)

    # create output directory if it doesn't exist
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
    if not os.path.exists(output_dir +'/video'):
        os.makedirs(output_dir +'/video')
    if not os.path.exists(output_dir +'/screenshot'):
        os.makedirs(output_dir +'/screenshot')

    extract_log_data_grouped(log_dir, output_dir)



if __name__ == "__main__":
    # main("/Users/gillianq/IdeaProjects/genai-labs/nova-act-demos/nova-act-local/annual-report-searches/PARSING_TARGET", "./amazonir/repeat")
    # main("//Users/gillianq/IdeaProjects/genai-labs/nova-act-demos/nova-act-local/annual-report-searches/logs/seclogs/2025-06-25_21-54-12", "./sec/report-run")
    # main("/Users/gillianq/IdeaProjects/genai-labs/nova-act-demos/nova-act-local/apartments_caltrain/logs", "./apart/hidef")
    main("/do-not-commit/annual-report-searches/logs/reportlogs/2025-06-25_21-34-07", "./reports_full")

