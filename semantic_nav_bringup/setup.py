from setuptools import setup, find_packages
import os
from glob import glob

package_name = 'semantic_nav_bringup'

setup(
    name=package_name,
    version='0.1.0',
    packages=find_packages(exclude=['test']),
    data_files=[
        ('share/ament_index/resource_index/packages', ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
        (os.path.join('share', package_name, 'launch'), glob('launch/*.py')),
        (os.path.join('share', package_name, 'config'), glob('config/*.yaml')),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='ashwinder',
    maintainer_email='ashwinder@todo.todo',
    description='Backend nodes for Semantic Keep-Out Navigation system',
    license='MIT',
    tests_require=['pytest'],
    entry_points={
        'console_scripts': [
            'label_db_node = semantic_nav_bringup.label_db_node:main',
            'intent_parser_node = semantic_nav_bringup.intent_parser_node:main',
            'target_resolver_node = semantic_nav_bringup.target_resolver_node:main',
            'dialogue_manager_node = semantic_nav_bringup.dialogue_manager_node:main',
            'navigation_executor_node = semantic_nav_bringup.navigation_executor_node:main',
            'teleop_guard_node = semantic_nav_bringup.teleop_guard_node:main',
            'hmi_server_node = semantic_nav_bringup.hmi_server_node:main',
        ],
    },
)
